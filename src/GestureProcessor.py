import json
import time

class GestureProcessor:
    
    def __init__(self,sensor,config):
        self.sensor = sensor
        self.config = config
        self.action = None
        self.requestCount = 0
        
    def run(self):
        return False 
    
    def nextAction(self):
        retval = self.action
        self.action = None
        #if retval:
        #    print(repr(retval))
        return json.dumps(retval) 
     
class SpinGestureProcessor(GestureProcessor):
    def __init__(self,sensor,config):
        GestureProcessor.__init__(self,sensor,config)
        self.position = 0.0
        self.rate = 0.0
        self.delta = 0

    def getSpin(self):
        retval = False
        if self.sensor.spinHistory.size():
            #print(repr(self.sensor.spinHistory.items))
            newDelta = sum(self.sensor.spinHistory.items) / self.sensor.spinHistory.size()
            self.sensor.spinHistory.enqueue(0)

            self.delta = newDelta
            if newDelta:
                retval = True
        return retval

    def run(self):
        if self.sensor and self.getSpin():
            self.action = { 'gesture': 'zoom',
                    'vector': {
                        'delta': self.delta
                    },
                    'id': self.requestCount }
            self.requestCount += 1
            return True
        return False


class TiltGestureProcessor(GestureProcessor):
    def __init__(self,sensor,config):
        GestureProcessor.__init__(self,sensor,config)
        self.Xtilt = 0.0
        self.Ytilt = 0.0

    def getTilt(self):
        retval = False
        if self.sensor.components[0].size() and self.sensor.components[1].size():
            newXtilt = sum(self.sensor.components[0].items) / self.sensor.components[0].size()
            if (abs(newXtilt) > self.config['tiltThreshold']):
                #if (abs(newXtilt-self.Xtilt) > 0.01):
                self.Xtilt = newXtilt
                retval = True
            else:
                self.Xtilt = 0.0
            newYtilt = sum(self.sensor.components[1].items) / self.sensor.components[1].size()
            if (abs(newYtilt) > self.config['tiltThreshold']):
                #if (abs(newYtilt-self.Ytilt) > 0.01):
                self.Ytilt = newYtilt
                retval = True
            else:
                self.Ytilt = 0.0
            # claculate the current tilt vector and put in self.Xtilt,self.Ytilt if not flat return true else false
            return retval
        return retval
    
    
    def run(self):
# FSM looking for various possible gestures if after clocking the fsm there is a complete gesture return a dictionary describing the response to the gestureotherwise false

    # the most common gesture is a simple tilt which is defined as a delta from flat
    # 
        if self.sensor and self.getTilt():
            self.action = { 'gesture': 'pan',
                  'vector': { 'x': self.Xtilt, 'y': self.Ytilt }
                        }
            return True 
        else:
            return False 
            
       
    
class TestHarnessGestureProcessor(GestureProcessor):
    def __init__(self,sensor,config):
        GestureProcessor.__init__(self,sensor,config)
        self.Xtilt = 0.0
        self.Ytilt = 0.0
        self.position = 0.0
        self.rate = 0.0
        self.delta = 0
        self.testSet = {}
        loops = 500
        stepsize = 10.0
        #for sp in range(loops):

        #    self.testSet['spin%d' % sp] = { 'time': 1, "spin": stepsize, "tilt": { 'x': 0, 'y': 0}}
        #self.testSet['end'] = { 'time': 25, "spin": -loops*stepsize, "tilt": { 'x': 0, 'y': 0}}
        self.testSet['start'] = { 'time': 10, "spin": 0, "tilt": { 'x': 0, 'y': 0}}
        self.testSet['end'] = { 'time': 2500, "spin": 0, "tilt": { 'x': 0, 'y': 0}}
            
        

        self.nextTest = 0
        self.nextTime = time.time() + self.testSet[list(self.testSet.keys())[self.nextTest]]['time']

    def getNextPose(self):
        retval = False
        if time.time() < self.nextTime:
            return retval
        if self.nextTest < len(self.testSet):
            element = self.testSet[list(self.testSet.keys())[self.nextTest]]
            self.Xtilt = element['tilt']['x']
            self.Ytilt = element['tilt']['y']
            self.delta = element['spin']
            self.nextTest += 1
            if self.nextTest >= len(self.testSet):
                self.nextTest = 0
            self.nextTime = time.time() + element['time']
            retval = True
        return retval
    
    
    def run(self):
# FSM looking for various possible gestures if after clocking the fsm there is a complete gesture return a dictionary describing the response to the gestureotherwise false

    # the most common gesture is a simple tilt which is defined as a delta from flat
    # 
        if self.getNextPose():
            #self.action = { 'gesture': 'combo',
            #    'vector': { 'x': self.Xtilt, 'y': self.Ytilt, 'delta': self.delta
            #        }}
            self.action = { 'gesture': 'zoom',
                'vector': { 'delta': self.delta
                    }}
            return True 
        else:
            return False 
            
       
    
