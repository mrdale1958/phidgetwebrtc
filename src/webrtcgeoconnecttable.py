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
from Phidget22.Devices.Spatial import Spatial
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
    def acceleration(self):
        return [self.components[0].head(), self.components[1].head(), self.components[2].head()]
        
    def setZeros(self,x0,y0,z0):
        self.zeros = [ x0, y0, z0 ]

    def setAccelerometerZero(self, index, newZero):
        self.zeros[index] = newZero

    def ingestSpatialData(self, sensorData):
        if self.components[0].qsize() == 0:
            self.setZeros(sensorData[0],sensorData[1],sensorData[2])
            print("new zero tilt",sensorData[0],sensorData[1],sensorData[2])
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
            print("new zero tilt",index,sensorData)
        newVector = sensorData - self.zeros[index]
        self.variances[index].enqueue(newVector - self.components[index].head())
        self.components[index].enqueue(newVector)
 

                      
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

# Handler for when a Spatial device is attached
def SpatialAttached(device):
    print(f"Spatial device attached: {device.getDeviceSerialNumber()}")

# Handler for when a Spatial device is detached
def SpatialDetached(device):
    print(f"Spatial device detached: {device.getDeviceSerialNumber()}")

# Handler for errors from a Spatial device
def SpatialError(device, errorCode, errorString):
    print(f"Spatial device error: {errorCode} - {errorString}")

# Handler for spatial data from a Spatial device
def SpatialData(device, spatialData, timestamp):
    #print(f"Spatial data received: {spatialData}")
    tiltdata.ingestSpatialData(spatialData[0].acceleration)

# Handler for accelerometer data (different signature than SpatialDataHandler)
def AccelerometerData(device, acceleration, timestamp):
    #print(f"Accelerometer data received: {acceleration}")
    tiltdata.ingestAccelerometerData(0, acceleration[0])
    tiltdata.ingestAccelerometerData(1, acceleration[1])
    tiltdata.ingestAccelerometerData(2, acceleration[2])

# Attempt to set up the tilter object
tiltdata = TiltData()
try:
        # Try to attach a Accelerometer device

    accelerometer = Accelerometer()
    accelerometer.setOnAttachHandler(SpatialAttached)
    accelerometer.setOnDetachHandler(SpatialDetached)
    accelerometer.setOnErrorHandler(SpatialError)
    accelerometer.setOnAccelerationChangeHandler(AccelerometerData)
    accelerometer.openWaitForAttachment(5000)
    tilter = accelerometer
    tiltdata.serialNumber = accelerometer.getDeviceSerialNumber()
    print(f"Accelerometer device attached with serial number: {tiltdata.serialNumber}")

except PhidgetException as e:
    print(f"Failed to attach Spatial device: {e.details}")
    print("Falling back to Accelerometer device...")
    try:
        # If Accelerometer fails, fall back to Spatial
        spatial = Spatial()
        spatial.setOnAttachHandler(SpatialAttached)
        spatial.setOnDetachHandler(SpatialDetached)
        spatial.setOnErrorHandler(SpatialError)
        spatial.setOnSpatialDataHandler(SpatialData)
        spatial.openWaitForAttachment(5000)
        tilter = spatial
        #tiltdata = TiltData()
        tiltdata.serialNumber = spatial.getDeviceSerialNumber()
        print(f"Spatial device attached with serial number: {tiltdata.serialNumber}")
    except PhidgetException as e:
        print(f"Failed to attach Spatial device: {e.details}")
        print("Exiting...")
        exit(1)

# Function to handle encoder position change events
def onEncoderPositionChange(device, positionChange, timeChange, indexTriggered):
    position = positionChange
    # print(f"Encoder Position: {position}")
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
spinner.openWaitForAttachment(5000)

conn = RTCConnection()  # For this example, we use just one global connection

@conn.subscribe
def onMessage(msg):  # Called when messages received from browser
    #print("Got message:", msg["data"])
    conn.put_nowait({"data": "pong"})

# Function to read accelerometer data and send it via WebRTC
async def send_accelerometer_data():
    while True:
        acceleration = tiltdata.acceleration()
        # Check if all accelerometer readings are below the threshold
        if (abs(acceleration[0]) < config['tiltThreshold'] and
            abs(acceleration[1]) < config['tiltThreshold']):
            # ending zeros if below threshold
            acceleration[0] = 0.0
            acceleration[1] = 0.0

        # Prepare and send data 
        data = {
            'gesture': 'pan',
            'vector': {
                'x': acceleration[0] ,
                'y': acceleration[1]
            }
        }
        conn.put_nowait(data)
        await asyncio.sleep(config['tiltSampleRate'])  # Adjust the frequency as needed

# Serve the RTCBot javascript library at /rtcbot.js
@routes.get("/rtcbot.js")
async def rtcbotjs(request):
    return web.Response(content_type="application/javascript", text=getRTCBotJS())


# This sets up the connection
@routes.post("/connect")
async def connect(request):
    global conn
    print("connect", request)
    clientOffer = await request.json()
    try:
        # Check if the underlying peer connection is closed
        if hasattr(conn, "pc") and getattr(conn, "pc", None):
            if getattr(conn.pc, "connectionState", None) == "closed":
                print("PeerConnection is closed, recreating...")
                conn = RTCConnection()
                # Re-subscribe the message handler
                @conn.subscribe
                def onMessage(msg):
                    print("Got message:", msg["data"])
                    conn.put_nowait({"data": "pong"})
        serverResponse = await conn.getLocalDescription(clientOffer)
        return web.json_response(serverResponse)
    except Exception as e:
        print(f"Error in /connect: {e}")
        return web.json_response({"error": str(e)}, status=500)

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
    
# Cleanup on shutdown
async def cleanup(app=None):
    if conn:
        await conn.close()
    print("WebRTC connection closed.")



app = web.Application()
app.add_routes(routes)
# Start the accelerometer data sending loop
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
loop.create_task(send_accelerometer_data())
app.on_shutdown.append(cleanup)

# Run the app
loop.run_until_complete(web._run_app(app, port=8080))