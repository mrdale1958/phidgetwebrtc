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
import time
import argparse


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
    'tiltThreshold' : 0.022,
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
        self.lastDataReceived = 0
        self.lastDataSent = 0
        self.serialNumber = ''

    def setZeros(self,x0,y0,z0):
        self.zeros = [ x0, y0, z0 ]

    def setAccelerometerZero(self, index, newZero):
        self.zeros[index] = newZero
        
    def getTilt(self):
        retval = False
        if self.components[0].qsize() and \
            self.components[1].qsize() and \
            self.lastDataReceived > self.lastDataSent:
            self.lastDataSent = time.time()
            newXtilt = sum(self.components[0].items) / self.components[0].qsize()
            if (abs(newXtilt) > config['tiltThreshold']):
                #if (abs(newXtilt-self.Xtilt) > 0.01):
                self.Xtilt = newXtilt
                retval = True
            else:
                self.Xtilt = 0.0
            newYtilt = sum(self.components[1].items) / self.components[1].qsize()
            if (abs(newYtilt) > config['tiltThreshold']):
                #if (abs(newYtilt-self.Ytilt) > 0.01):
                self.Ytilt = newYtilt
                retval = True
            else:
                self.Ytilt = 0.0
            # claculate the current tilt vector and put in self.Xtilt,self.Ytilt if not flat return true else false
            #print(self.sensor.components[0].items,self.sensor.components[1].items)
            return retval
        return retval

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
        self.lastDataReceived = time.time()
    
    def ingestAccelerometerData(self, index, sensorData):
        if self.components[index].qsize() == 0:
            self.setAccelerometerZero(index,sensorData)
        newX = sensorData - self.zeros[index]
        self.variances[index].enqueue(newX - self.components[index].head())
        self.components[index].enqueue(newX)
 

                      
    def getJSON(self):
        jsonBundle = { 'gesture': 'pan',
                  'vector': { 'x': self.Xtilt, 'y': self.Ytilt }
                        }
                    
    
        #return(JSON.dumps(jsonBundle))
        return(jsonBundle)
    
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


# Function to handle encoder position change events
def onEncoderPositionChange(device, positionChange, timeChange, indexTriggered):
    position = positionChange
    #print(f"Encoder Position: {position}")
    action = { 'gesture': 'zoom',
                    'vector': {
                        'delta': positionChange
                    },
                    'id': 666 }
    data = {
        "encoder_position": position
    }
    conn.put_nowait(action)

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
    #print("spatialData", acceleration)
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


# Function to read accelerometer data and send it via WebRTC
async def send_accelerometer_data():
    while True:
        #acceleration = tilter.getAcceleration()
        if (tiltdata.getTilt()):
            data = action = tiltdata.getJSON()
            #print(data)
            conn.put_nowait(data)
        await asyncio.sleep(0.1)  # Adjust the frequency as needed

# Serve the RTCBot javascript library at /rtcbot.js
@routes.get("/rtcbot.js")
async def rtcbotjs(request):
    return web.Response(content_type="application/javascript", text=getRTCBotJS())


# This sets up the connection
@routes.post("/connect")
async def connect(request):
    global conn
    clientOffer = await request.json()
    
    try:
        if conn is None or getattr(conn._rtc, "connectionState", None) == "closed":
            conn = RTCConnection()
        serverResponse = await conn.getLocalDescription(clientOffer)
        return web.json_response(serverResponse)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# List of static files to serve (relative to the 'static' directory)
STATIC_FILES = [
    "index.html",
    "SLP.css",
    "SLP.js",
    "SLPConfig.js",
    "OptimizedDataDetector.js",
    "VirtualTable.js",
    "maps_api_key.js",
    "clarklogo.png",
    "mask.png",
    "svg.js",
]

@routes.get("/{filename}")
async def static_file_handler(request):
    filename = request.match_info["filename"]
    if filename not in STATIC_FILES:
        raise web.HTTPNotFound()
    file_path = os.path.join(os.path.dirname(__file__), "static", filename)
    # Guess content type
    content_types = {
        ".js": "application/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".html": "text/html",
    }
    ext = os.path.splitext(filename)[1]
    content_type = content_types.get(ext, "application/octet-stream")
    return web.FileResponse(file_path, headers={"Content-Type": content_type})

# Special case for root ("/") to serve index.html
@routes.get("/")
async def index(request):
    file_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    return web.FileResponse(file_path)
    

async def cleanup(app=None):
    result = conn.close()
    if asyncio.iscoroutine(result):
        await result
        
app = web.Application()
app.add_routes(routes)
# Create and set the event loop
#loop = asyncio.new_event_loop()
#asyncio.set_event_loop(loop)
#loop.create_task(send_accelerometer_data())
#app.on_shutdown.append(cleanup)

# Run the app
#loop.run_until_complete(web._run_app(app, port=8080))

#app.on_shutdown.append(cleanup)

async def start_background_tasks(app):
    app['accel_task'] = asyncio.create_task(send_accelerometer_data())

async def cleanup_background_tasks(app):
    app['accel_task'].cancel()
    try:
        await app['accel_task']
    except asyncio.CancelledError:
        pass

app.on_startup.append(start_background_tasks)
app.on_cleanup.append(cleanup_background_tasks)

def setup_phidgets_and_rtc(app):
    global conn, spinner, spindata, accelerometer, tiltdata, tilter

    try:
        spinner = Encoder()
        spindata = SpinData()
    except RuntimeError as e:
        print("Runtime spinner Exception: %s" % e)
        print("Exiting....")
        return False

    try:
        accelerometer = Accelerometer()
        tiltdata = TiltData()
    except RuntimeError as e:
        print("Runtime Exception: %s" % e)
        print("Exiting....")
        return False

    spinner.setOnPositionChangeHandler(onEncoderPositionChange)
    tilter = Accelerometer()
    tilter.setOnAttachHandler(SpatialAttached)
    tilter.setOnDetachHandler(SpatialDetached)
    tilter.setOnErrorHandler(SpatialError)
    tilter.setOnAccelerationChangeHandler(SpatialData)
    tilter.openWaitForAttachment(5000)
    tiltdata.serialNumber = tilter.getDeviceSerialNumber()
    spinner.openWaitForAttachment(5000)

    conn = RTCConnection()  # Only create in this function

    @conn.subscribe
    def onMessage(msg):
        #print("Got message:", msg["data"])
        conn.put_nowait({"data": "pong"})

    async def send_accelerometer_data():
        while True:
            if (tiltdata.getTilt()):
                data = tiltdata.getJSON()
                #print(data)
                conn.put_nowait(data)
            await asyncio.sleep(0.1)

    async def start_background_tasks(app):
        app['accel_task'] = asyncio.create_task(send_accelerometer_data())

    async def cleanup_background_tasks(app):
        app['accel_task'].cancel()
        try:
            await app['accel_task']
        except asyncio.CancelledError:
            pass

    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)

    # Register RTCBot routes only if RTC is enabled
    @routes.get("/rtcbot.js")
    async def rtcbotjs(request):
        return web.Response(content_type="application/javascript", text=getRTCBotJS())

    @routes.post("/connect")
    async def connect(request):
        global conn
        clientOffer = await request.json()
        try:
            if conn is None or getattr(conn._rtc, "connectionState", None) == "closed":
                conn = RTCConnection()
            serverResponse = await conn.getLocalDescription(clientOffer)
            return web.json_response(serverResponse)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    return True

# --- Static file routes (always registered) ---
STATIC_FILES = [
    "index.html", "SLP.css", "SLP.js", "SLPConfig.js", "OptimizedDataDetector.js",
    "VirtualTable.js", "maps_api_key.js", "clarklogo.png", "mask.png", "svg.js",
]

@routes.get("/{filename}")
async def static_file_handler(request):
    filename = request.match_info["filename"]
    if filename not in STATIC_FILES:
        raise web.HTTPNotFound()
    file_path = os.path.join(os.path.dirname(__file__), "static", filename)
    content_types = {
        ".js": "application/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".html": "text/html",
    }
    ext = os.path.splitext(filename)[1]
    content_type = content_types.get(ext, "application/octet-stream")
    return web.FileResponse(file_path, headers={"Content-Type": content_type})

@routes.get("/")
async def index(request):
    file_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    return web.FileResponse(file_path)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GeoConnectTable WebRTC Server")
    parser.add_argument("--no-phidgets", action="store_true", help="Start webserver without Phidgets or WebRTC")
    args = parser.parse_args()

    app = web.Application()
    app.add_routes(routes)

    if not args.no_phidgets:
        setup_phidgets_and_rtc(app)

    web.run_app(app, port=8080)
