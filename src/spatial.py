from Phidget22.PhidgetException import *
from Phidget22.Phidget import *
from Phidget22.Devices.Log import *
from Phidget22.LogLevel import *
from Phidget22.Devices.Accelerometer import *
import traceback
import time

#Declare any event handlers here. These will be called every time the associated event occurs.

def onAccelerometer0_AccelerationChange(self, acceleration, timestamp):
	print("Acceleration: \t"+ str(acceleration[0])+ "  |  "+ str(acceleration[1])+ "  |  "+ str(acceleration[2]))
	print("Timestamp: " + str(timestamp))
	print("----------")

def onAccelerometer0_Attach(self):
	print("Attach!")
	
def onAccelerometer0_Detach(self):
	print("Detach!")

def onAccelerometer0_Error(self, code, description):
	print("Code: " + ErrorEventCode.getName(code))
	print("Description: " + str(description))
	print("----------")

def main():
	try:
		Log.enable(LogLevel.PHIDGET_LOG_INFO, "phidgetlog.log")
		#Create your Phidget channels
		accelerometer0 = Accelerometer()

		#Set addressing parameters to specify which channel to open (if any)

		#Assign any event handlers you need before calling open so that no events are missed.
		accelerometer0.setOnAccelerationChangeHandler(onAccelerometer0_AccelerationChange)
		accelerometer0.setOnAttachHandler(onAccelerometer0_Attach)
		accelerometer0.setOnDetachHandler(onAccelerometer0_Detach)
		accelerometer0.setOnErrorHandler(onAccelerometer0_Error)

		#Open your Phidgets and wait for attachment
		accelerometer0.openWaitForAttachment(5000)

		#Do stuff with your Phidgets here or in your event handlers.
		accelerometer0.setDataRate(100)
		accelerometer0.setAccelerationChangeTrigger(0.01)

		try:
			input("Press Enter to Stop\n")
		except (Exception, KeyboardInterrupt):
			pass

		#Close your Phidgets once the program is done.
		accelerometer0.close()

	except PhidgetException as ex:
		#We will catch Phidget Exceptions here, and print the error informaiton.
		traceback.print_exc()
		print("")
		print("PhidgetException " + str(ex.code) + " (" + ex.description + "): " + ex.details)


main()