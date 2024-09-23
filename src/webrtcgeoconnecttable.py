""" Set up webrtc service for running GeoConnectTable on Onomy Labs Spinny Table 
Copyright 2024 Bother Consulting
This work is licensed under the Creative Commons Attribution 4.0 International License. 
To view a copy of this license, visit http://creativecommons.org/licenses/by/4.0/
"""

import datetime
import os.path
import asyncio
import json as JSON
from aiohttp import web
from rtcbot import RTCConnection, getRTCBotJS
from Phidget22.Devices.Accelerometer import Accelerometer
from Phidget22.Devices.Encoder import Encoder
from Phidget22.PhidgetException import PhidgetException
from GestureProcessor import TiltGestureProcessor, SpinGestureProcessor


__author__ = 'Dale MacDonald'
__version__ = '3.0.0'
__date__ = 'September 21, 2024'


routes = web.RouteTableDef()


#from queue import Queue
config = {
    'tiltHistoryLength':10,
    'spinHistoryLength':10,
    'accelerometerQueueLength':10,
    'encoderQueueLength':10,
    'tiltSampleRate' : 0.1,
    'tiltThreshold' : 0.002,
    'flipX' : 1,
    'flipY' : -1,
    'flipZ' : -1,
}
tilter = None
class Queue:
    """ A simple Queue mechanism to store the last N values of a sensor stream """
    def __init__(self, maxLength=10):
        self.items = []
        self.maxLength = maxLength

    def isEmpty(self):
        return not self.items

    def enqueue(self, item):
        self.items.insert(0,item)
        if self.qsize() > self.maxLength:
            self.dequeue()
    
    def dequeue(self):
        if self.qsize():
            return self.items.pop()

    def head(self):
        if self.qsize():
            return self.items[0]
        return(0.0)

    def tail(self):
        if self.qsize():
            return self.items[self.qsize()-1]
        return(0.0)

    def qsize(self):
        return len(self.items)

class SpinData:
    def __init__(self, positionChange=0, elapsedtime=0.0, position=0):
        self.gestureProcessor = SpinGestureProcessor(self, config)
        self.position = position
        self.delta = positionChange
        self.timestamp = datetime.time()
        self.elapsedTime = elapsedtime
        self.spinHistory = Queue(config['encoderQueueLength'])

    def ingestSpinData(self, positionChange, time):
        self.delta = positionChange
        self.elapsedTime = time
        self.spinHistory.enqueue( positionChange * config['flipZ'])

class TiltData:

    def __init__(self):
        self.gestureProcessor = TiltGestureProcessor(self, config)
        self.components = [ Queue(config['accelerometerQueueLength']), Queue(config['accelerometerQueueLength']), Queue(config['accelerometerQueueLength']) ]
        self.variances =  [ Queue(config['accelerometerQueueLength']), Queue(config['accelerometerQueueLength']), Queue(config['accelerometerQueueLength']) ]
        self.magnitude = 0.0
        self.zeros = [ 0.0, 0.0, 0.0 ]

        self.serialNumber = ''

    def setZeros(self,x0,y0,z0):
        self.zeros = [ x0, y0, z0 ]

    def setAccelerometerZero(self, index, newZero):
        self.zeros[index] = newZero

    def ingestSpatialData(self, sensorData):
        if self.components[0].qsize() == 0:
            self.setZeros(sensorData[0],sensorData[1],sensorData[2])
        newX = config['flipX'] * (sensorData[0] - self.zeros[0])
        newY = config['flipY'] * (sensorData[1] - self.zeros[1])
        newZ = sensorData[2] - self.zeros[2]
        self.variances[0].enqueue(newX - self.components[0].head())
        self.variances[1].enqueue(newY - self.components[1].head())
        self.variances[2].enqueue(newZ - self.components[2].head())
        self.components[0].enqueue(newX)
        self.components[1].enqueue(newY)
        self.components[2].enqueue(newZ) 
     
    def ingestAccelerometerData(self, index, sensorData):
        if self.components[index].qsize() == 0:
            self.setAccelerometerZero(index,sensorData)
        newX = sensorData - self.zeros[index]
        self.variances[index].enqueue(newX - self.components[index].head())
        self.components[index].enqueue(newX)
 

                      
    def getJSON(self):
        jsonBundle = { 'type':        'tilt',
                    'packet': { 'sensorID':  '',
                    'tiltX': 0.0,
                    'tiltY': 0.0
                    }
                   }
                    
    
        return(JSON.dumps(jsonBundle))
    
#class SpinVector:



tiltVector = {
    'direction': [0.0,0.0],
    'magnitude': 0.0,
    'time': 0
    }

tiltHistory = Queue()

spinVector = { 
    'delta': 0.0,
    'rate':0.0,
    'time': 0
    }
spinHistory = Queue()


#Create an encoder object
try:
    spinner = Encoder()
    spindata = SpinData()
except RuntimeError as e:
    print("Runtime spinner Exception: %s" % e)
    print("Exiting....")
    # exit(1)

#Create an accelerometer object
try:
#    spatial = Spatial()
    accelerometer = Accelerometer()
    tiltdata = TiltData()

except RuntimeError as e:
    print("Runtime Exception: %s" % e)
    print("Exiting....")
    exit(1)

# Function to handle encoder position change events
def onEncoderPositionChange(device, positionChange, timeChange, indexTriggered):
    position = positionChange
    print(f"Encoder Position: {position}")
    action = { 'gesture': 'zoom',
                    'vector': {
                        'delta': positionChange
                    },
                    'id': 666 }
    data = {
        "encoder_position": position
    }
    conn.put_nowait(action)

# Attach the encoder position change event handler
spinner.setOnPositionChangeHandler(onEncoderPositionChange)

# Initialize the Phidget accelerometer
tilter = Accelerometer()
def SpatialAttached(e):
    attached = e
    tiltdata.serialNumber = attached.getDeviceSerialNumber()

    print("Spatial %i Attached!" % (attached.getDeviceSerialNumber()))

def SpatialDetached(e):
    detached = e
    print("Spatial %i Detached!" % (detached.getDeviceSerialNumber()))

def SpatialError(e):
    try:
        source = e
        print("Spatial %i: Phidget Error %i: %s" % (source.getDeviceSerialNumber(), e.eCode, e.description))
    except PhidgetException as e:
        print("Phidget Exception %i: %s" % (e.code, e.details))
def SpatialData(device, acceleration, timestamp):
    source = device
    if tiltdata.serialNumber == source.getDeviceSerialNumber():
        if tiltdata:
            tiltdata.ingestSpatialData(acceleration)
        # for index, spatialData in enumerate(e.spatialData):
        #     print("=== Data Set: %i ===" % (index))
        #     if len(spatialData.Acceleration) > 0:
        #         print("Acceleration> x: %6f  y: %6f  z: %6f" % (spatialData.Acceleration[0], spatialData.Acceleration[1], spatialData.Acceleration[2]))
        #     if len(spatialData.AngularRate) > 0:
        #         print("Angular Rate> x: %6f  y: %6f  z: %6f" % (spatialData.AngularRate[0], spatialData.AngularRate[1], spatialData.AngularRate[2]))
        #     if len(spatialData.MagneticField) > 0:
        #         print("Magnetic Field> x: %6f  y: %6f  z: %6f" % (spatialData.MagneticField[0], spatialData.MagneticField[1], spatialData.MagneticField[2]))
        #     print("Time Span> Seconds Elapsed: %i  microseconds since last packet: %i" % (spatialData.Timestamp.seconds, spatialData.Timestamp.microSeconds))
        
        # print("------------------------------------------")
    else:
        print("wrong device: expected-", tiltdata.serialNumber, "got-", source.getDeviceSerialNumber())

try:
    #logging example, uncomment to generate a log file
    #spatial.enableLogging(PhidgetLogLevel.PHIDGET_LOG_VERBOSE, "phidgetlog.log")


    tilter.setOnAttachHandler(SpatialAttached)
    tilter.setOnDetachHandler(SpatialDetached)
    tilter.setOnErrorHandler(SpatialError)
    tilter.setOnAccelerationChangeHandler(SpatialData)
except PhidgetException as e:
    print("Phidget Exception %i: %s" % (e.code, e.details))
    print("Exiting....")
    tilter = None


conn = RTCConnection()  # For this example, we use just one global connection

@conn.subscribe
def onMessage(msg):  # Called when messages received from browser
    print("Got message:", msg["data"])
    conn.put_nowait({"data": "pong"})

# Function to read accelerometer data and send it via WebRTC
async def send_accelerometer_data():
    while True:
        acceleration = tilter.getAcceleration()
        data = action = { 'gesture': 'pan',
                  'vector': { 'x': acceleration[0], 'y': acceleration[1]}
                        }
        
        conn.put_nowait(data)
        await asyncio.sleep(0.1)  # Adjust the frequency as needed

# Serve the RTCBot javascript library at /rtcbot.js
@routes.get("/rtcbot.js")
async def rtcbotjs(request):
    return web.Response(content_type="application/javascript", text=getRTCBotJS())


# This sets up the connection
@routes.post("/connect")
async def connect(request):
    clientOffer = await request.json()
    serverResponse = await conn.getLocalDescription(clientOffer)
    return web.json_response(serverResponse)


@routes.get("/")
async def index(request):
    file_path = os.path.join(os.path.dirname(__file__), 'static', 'index.html')
    return web.FileResponse(file_path)
@routes.get("/SLP.css")
async def slpcss(request):
    file_path = os.path.join(os.path.dirname(__file__), 'static', 'SLP.css')
    return web.FileResponse(file_path)
@routes.get("/SLP.js")
async def slpjs(request):
    file_path = os.path.join(os.path.dirname(__file__), 'static', 'SLP.js')
    return web.FileResponse(file_path)
@routes.get("/SLPConfig.js")
async def slpconfig(request):
    file_path = os.path.join(os.path.dirname(__file__), 'static', 'SLPConfig.js')
    return web.FileResponse(file_path)
@routes.get("/mask.png")
async def maskpng(request):
    file_path = os.path.join(os.path.dirname(__file__), 'static', 'mask.png')
    return web.FileResponse(file_path)
@routes.get("/svg.js")
async def svgjs(request):
    file_path = os.path.join(os.path.dirname(__file__), 'static', 'svg.js')
    return web.FileResponse(file_path)
    

async def cleanup(app=None):
    await conn.close()

app = web.Application()
app.add_routes(routes)
# Start the accelerometer data sending loop
tilter.openWaitForAttachment(5000)
tiltdata.serialNumber = tilter.getDeviceSerialNumber()

spinner.openWaitForAttachment(5000)
# Create and set the event loop
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
loop.create_task(send_accelerometer_data())
app.on_shutdown.append(cleanup)

# Run the app
loop.run_until_complete(web._run_app(app, port=8080))