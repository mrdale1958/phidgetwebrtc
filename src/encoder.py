from Phidget22.PhidgetException import *
from Phidget22.Phidget import *
from Phidget22.Devices.Log import *
from Phidget22.LogLevel import *
from Phidget22.Devices.Encoder import *
import traceback
import time

#Declare any event handlers here. These will be called every time the associated event occurs.

def onEncoder0_PositionChange(self, positionChange, timeChange, indexTriggered):
	print("PositionChange: " + str(positionChange))
	print("TimeChange: " + str(timeChange))
	print("IndexTriggered: " + str(indexTriggered))
	print("getPosition: " + str(self.getPosition()))
	print("----------")

def onEncoder0_Attach(self):
	print("Attach!")

def onEncoder0_Detach(self):
	print("Detach!")

def onEncoder0_Error(self, code, description):
	print("Code: " + ErrorEventCode.getName(code))
	print("Description: " + str(description))
	print("----------")

def main():
	try:
		Log.enable(LogLevel.PHIDGET_LOG_INFO, "phidgetlog.log")
		#Create your Phidget channels
		encoder0 = Encoder()

		#Set addressing parameters to specify which channel to open (if any)

		#Assign any event handlers you need before calling open so that no events are missed.
		encoder0.setOnPositionChangeHandler(onEncoder0_PositionChange)
		encoder0.setOnAttachHandler(onEncoder0_Attach)
		encoder0.setOnDetachHandler(onEncoder0_Detach)
		encoder0.setOnErrorHandler(onEncoder0_Error)

		#Open your Phidgets and wait for attachment
		encoder0.openWaitForAttachment(5000)

		#Do stuff with your Phidgets here or in your event handlers.

		try:
			input("Press Enter to Stop\n")
		except (Exception, KeyboardInterrupt):
			pass

		#Close your Phidgets once the program is done.
		encoder0.close()

	except PhidgetException as ex:
		#We will catch Phidget Exceptions here, and print the error informaiton.
		traceback.print_exc()
		print("")
		print("PhidgetException " + str(ex.code) + " (" + ex.description + "): " + ex.details)


main()