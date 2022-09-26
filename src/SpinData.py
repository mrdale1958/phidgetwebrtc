from GestureProcessor import SpinGestureProcessor, TestHarnessGestureProcessor
from Queue import Queue
from Phidget22.Devices.Encoder import *
import logging
from Phidget22.PhidgetException import *
import datetime

class SpinData:

    _all = set()
    _logger = None
    _spinner  = Encoder()
    _waitTimeForConnect = 5000
    
    def __init__(self,
                 config = {},
                 positionChange=0,
                 elapsedtime=0.0,
                 position=0):
        SpinData._all.add(self)
        self.config = config
        self.gestureProcessor = SpinGestureProcessor(self, config)
        self.position = position
        self.delta = positionChange
        self.timestamp = datetime.time()
        self.elapsedTime = elapsedtime
        self.spinHistory = Queue(config['encoderQueueLength'])
        
        if (SpinData._logger == None):
            SpinData._logger = logging.getLogger('spinsensorserver')

        try:
            SpinData._spinner.setOnAttachHandler(SpinData.encoderAttached)
            SpinData._spinner.setOnDetachHandler(SpinData.encoderDetached)
            SpinData._spinner.setOnErrorHandler(SpinData.encoderError)
                # _spinner.setOnInputChangeHandler(encoderInputChange)
            SpinData._spinner.setOnPositionChangeHandler(SpinData.encoderPositionChange)
        except PhidgetException as e:
            d = {'clientip': "spinner", 'user':"__init__"}
            SpinData._logger.critical('_spinner init failed: %s', 'details%s'% e.details, extra=d)
            SpinData._spinner = None
        try:
            SpinData._spinner.openWaitForAttachment(SpinData._waitTimeForConnect)
            SpinData._spinner.setDataInterval(SpinData._spinner.getMinDataInterval());
        except PhidgetException as e:
            d = {'clientip': "spinner", 'user':"open"}
            SpinData._logger.critical('_spinner connect failed: %s', 'details%s'% e.details, extra=d)
            SpinData._spinner = None


    def ingestSpinData(self, positionChange, time):
        self.delta = positionChange
        self.elapsedTime = time
        self.spinHistory.enqueue( positionChange * self.config['flipZ'])

    #Information Display Function
    def displayDeviceInfo():
        pass

    #Event Handler Callback Functions
    def encoderAttached(e):
        attached = e
        try:
            print("\nAttach Event Detected (Information Below)")
            print("===========================================")
            print("Library Version: %s" % attached.getLibraryVersion())
            print("Serial Number: %d" % attached.getDeviceSerialNumber())
            print("Channel: %d" % attached.getChannel())
            print("Channel Class: %s" % attached.getChannelClass())
            print("Channel Name: %s" % attached.getChannelName())
            print("Device ID: %d" % attached.getDeviceID())
            print("Device Version: %d" % attached.getDeviceVersion())
            print("Device Name: %s" % attached.getDeviceName())
            print("Device Class: %d" % attached.getDeviceClass())
            print("\n")

        except PhidgetException as e:
            print("Phidget Exception %i: %s" % (e.code, e.details))
            print("Press Enter to Exit...\n")
            readin = sys.stdin.read(1)

        d = {'clientip': "spinner", 'user':"encoderAttached"}
        SpinData._logger.info('Encoder Attached! %s', 'good news', extra=d)
        d = { 'clientip': "spinner", 'user': "getMinPositionChangeTrigger %d getPositionChangeTrigger %d" %(SpinData._spinner.getMinPositionChangeTrigger(), SpinData._spinner.getPositionChangeTrigger())}
        SpinData._logger.critical('Encoder setup: %s', "hmmm", extra=d)

    def encoderDetached(e):
        detached = e
        d = {'clientip': "spinner", 'user':"encoderDetached" }
        SpinData._logger.warning('Encoder Detached: %s', detached.getDeviceSerialNumber(), extra=d)

    def encoderError(e, eCode, description):
        source = e
        d = {'clientip': "spinner", 'user':"encoderError"}
        SpinData._logger.error('Encoder error %s', description, extra=d)
 
    def encoderInputChange(e):
        source = e.device
        

    def encoderPositionChange(e, positionChange, timeChange, indexTriggered):
        source = e
        for spinner in SpinData._all:
            spinner.ingestSpinData(positionChange, timeChange)
