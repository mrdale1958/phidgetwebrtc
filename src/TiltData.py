from GestureProcessor import TiltGestureProcessor, TestHarnessGestureProcessor
from Queue import Queue
from Phidget22.Devices.Accelerometer import *
import logging
from Phidget22.PhidgetException import *
import datetime

class TiltData:
    _all = set()
    _logger = None
    _accelerometer  = Accelerometer()
    _waitTimeForConnect = 5000

    def __init__(self,
                 config = {},
                 positionChange=0,
                 elapsedtime=0.0,
                 position=0):
        TiltData._all.add(self)
        self.gestureProcessor = TiltGestureProcessor(self, config)
        self.queueLength = config['accelerometerQueueLength']
        self.components = [ Queue(self.queueLength),
                            Queue(self.queueLength),
                            Queue(self.queueLength) ]
        self.variances =  [ Queue(self.queueLength),
                            Queue(self.queueLength),
                            Queue(self.queueLength) ]
        self.magnitude = 0.0
        self.zeros = [ 0.0, 0.0, 0.0 ]
        self.serialNumber = ''

        
        if (TiltData._logger == None):
            TiltData._logger = logging.getLogger('tiltsensorserver')

        try:
            TiltData._accelerometer.setOnAttachHandler(TiltData._accelerometerAttached)
            TiltData._accelerometer.setOnDetachHandler(TiltData._accelerometerDetached)
            TiltData._accelerometer.setOnErrorHandler(TiltData._accelerometerError)
            TiltData._accelerometer.setOnAccelerationChangeHandler(TiltData._accelerometerAccelerationChanged)
        except PhidgetException as e:
            _accelerometer = None
            d = {'clientip': "tilter", 'user':"__init__"}
            TiltData._logger.critical('Tilter init failed: %s', e.details, extra=d)
        try:
            TiltData._accelerometer.openWaitForAttachment(TiltData._waitTimeForConnect)
        except PhidgetException as e:
            d = {'clientip': "tilter", 'user':"open"}
            TiltData._logger.critical('Tilter connect failed: %s', e.details, extra=d)
            TiltData._accelerometer = None


    def setZeros(self,x0,y0,z0):
        self.zeros = [ x0, y0, z0 ]

    def set_accelerometerZero(self, index, newZero):
        self.zeros[index] = newZero

    def level_table(self):
        self.components = [ Queue(self.queueLength),
                            Queue(self.queueLength),
                            Queue(self.queueLength) ]
        self.variances =  [ Queue(self.queueLength),
                            Queue(self.queueLength),
                            Queue(self.queueLength) ]
        
        

    def ingestSpatialData(self, sensorData):
        if self.components[0].size() == 0:
            self.setZeros(sensorData.Acceleration[0],sensorData.Acceleration[1],sensorData.Acceleration[2])
        newX = config['flipX'] * (sensorData.Acceleration[0] - self.zeros[0])
        newY = config['flipY'] * (sensorData.Acceleration[1] - self.zeros[1])
        newZ = sensorData.Acceleration[2] - self.zeros[2]
        self.variances[0].enqueue(newX - self.components[0].head())
        self.variances[1].enqueue(newY - self.components[1].head())
        self.variances[2].enqueue(newZ - self.components[2].head())
        self.components[0].enqueue(newX)
        self.components[1].enqueue(newY)
        self.components[2].enqueue(newZ) 
     
    def ingest_accelerometerData(self, sensorData):
        for index in range(3):
            if self.components[index].size() == 0:
                self.set_accelerometerZero(index,sensorData[index])
            newX = sensorData[index] - self.zeros[index]
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
    
    def _accelerometerAttached(e):
        attached = e
        for tilter in TiltData._all:
            tilter.serialNumber = attached.getDeviceSerialNumber()
        
        d = {'clientip': "tilter", 'user':"_accelerometerAttached", 'foo': "accelerometer attached"}
        TiltData._logger.info('accelerometer Attached! %s', 'yay', extra=d)

    def _accelerometerDetached(e):
        detached = e
        d = {'clientip': "tilter", 'user':"_accelerometerDetached", 'foo': "accelerometer Detached! %s" % (detached.getDeviceSerialNumber())}
        TiltData._logger.warning('accelerometer  Detached! %s', 'connection reset', extra=d)

    def _accelerometerError(e, eCode, description):

        d = {'clientip': "tilter", 'user':"_accelerometerError"}
        TiltData._logger.error('_accelerometerError %s', description, extra=d)

    def _accelerometerAccelerationChanged(e, acceleration, timestamp):
        # print("Acceleration: %f  %f  %f" % (acceleration[0], acceleration[1], acceleration[2]))
        # print("Timestamp: %f\n" % timestamp)
        #TiltData._logger.info('accelerometer data %s', "checking", extra=d)
        for tilter in TiltData._all:
            #print(tilter.serialNumber, e.getDeviceSerialNumber(), len(TiltData._all ))     
            if tilter.serialNumber == e.getDeviceSerialNumber():
                #print(repr(tilter), len(TiltData._all ))     
                if tilter:
                    tilter.ingest_accelerometerData(acceleration)

    #   print("_accelerometer %i: Axis %i: %6f" % (source.getDeviceSerialNumber(), e.index, e.acceleration))



