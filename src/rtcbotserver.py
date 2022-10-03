import logging
import argparse
import socket
import datetime
from shutil import copyfile
from GestureProcessor import TiltGestureProcessor, SpinGestureProcessor, TestHarnessGestureProcessor
from Queue import Queue
from SpinData import SpinData
from TiltData import TiltData
import asyncio

from aiohttp import web
routes = web.RouteTableDef()

from rtcbot import RTCConnection, getRTCBotJS


parser = argparse.ArgumentParser(prog='tiltyserver', description='Serve Phidget sensor data via websocket.')
parser.add_argument('--localhost', action='store_true', 
                   help='force use of 127.0.0.1')
parser.add_argument('--port', '-p', 
                    type=int, dest='local_port_num',
                    default=5678,
                   help='set a tcp port for the server (default: 5678)')
parser.add_argument('--loglevel', nargs=1,
                    choices=['info', 'warning', 'debug', 'error', 'critical'],
                    default=['info'],
                   help='set a log level for the server (default: warning; options: info, warning, debug, error, critical)') 
parser.add_argument('--logfilename', 
                    default='/var/log/tilty/server.log',
                   help='set a filename for logging (default: /var/log/tilty/server.log)')
parser.add_argument('--accelerometerQueueLength', 
                    type=int, dest='accelerometerQueueLength',
                    default=10,
                    help='queue length for averaging tilt data')
parser.add_argument('--encoderQueueLength', 
                    type=int, dest='encoderQueueLength',
                    default=1,
                    help='queue length for averaging spin data')
parser.add_argument('--tiltSampleRate', 
                    type=float, dest='tiltSampleRate',
                    default=0.1,
                    help='delay (in seconds?) to wait between sending message sets')
parser.add_argument('--tiltThreshold', 
                    type=float, dest='tiltThreshold',
                    default=0.002,
                    help='minimum accelerometer deflection from 0 to register as tilt')
parser.add_argument('--swapXY', 
                    type=int, dest='swapXY',
                    default=0,
                    help='change the logic of tilt to deal with mounting orientation')
parser.add_argument('--flipX', 
                    type=int, dest='flipX',
                    default=1,
                    help='change the logic of tilt along the left-right axis')
parser.add_argument('--flipY', 
                    type=int, dest='flipY',
                    default=-1,
                    help='change the logic of tilt along the near-far axis')
parser.add_argument('--flipZ', 
                    type=int, dest='flipZ',
                    default=-1,
                    help='change the logic of spin direction on zoom')
args = parser.parse_args()

numeric_level = getattr(logging, args.loglevel[0].upper(), None)
if not isinstance(numeric_level, int):
    raise ValueError('Invalid log level: %s' % args.loglevel[0].upper())
copyfile(args.logfilename, args.logfilename + '.previous')
#FORMAT = '%(asctime)-15s %(clientip)s %(user)-8s %(message)s'
FORMAT = '%(asctime)-15s  %(message)s'
logging.basicConfig(format=FORMAT, level=numeric_level, filename=args.logfilename, filemode='w', )
logger = logging.getLogger('sensorserver')
websocket_logger = logging.getLogger('websockets.server')
websocket_logger.setLevel(logging.DEBUG)
websocket_logger.addHandler(logging.StreamHandler)

server_port = args.local_port_num

if (args.localhost):
    local_ip_address = "127.0.0.1"
else:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 1))  # connect() for UDP doesn't send packets
    local_ip_address = s.getsockname()[0]
d = {'clientip': local_ip_address, 'user': 'pi'}
logger.warning('Server starting: %s', 'defaults loaded %s %s' %(local_ip_address,args), extra=d)

config = {
    'accelerometerQueueLength': args.accelerometerQueueLength,
    'encoderQueueLength': args.encoderQueueLength,
    'tiltSampleRate' : args.tiltSampleRate,
    'tiltThreshold' : args.tiltThreshold,
    'swapXY' : args.swapXY,
    'flipX' : args.flipX,
    'flipY' : args.flipY,
    'flipZ' : args.flipZ,
}

#Create an encoder object
try:
    spindata = SpinData(config=config)
except RuntimeError as e:

    d = {'clientip': local_ip_address, 'user': 'pi'}
    logger.error('Spin server starting error: %s', "Runtime spinner Exception: %s" % e.details, extra=d)
    # exit(1)

#Create an accelerometer object
try:
    tiltdata = TiltData(config=config)

except RuntimeError as e:
    print()
    print("Exiting....")
    d = {'clientip': local_ip_address, 'user': 'pi'}

    logger.error('Tilt server starting error: %s', "Runtime Exception: %s" % e.details, extra=d)
    exit(1)
testgp = None # TestHarnessGestureProcessor(None, config)

# For this example, we use just one global connection
running = False
print("setting up RTC")
conn = RTCConnection()
@conn.onReady
def readyCallback():
    print("RTC Ready!")
    
async def tilt():
    d = {'clientip': local_ip_address, 'user': 'pi', }
    #logger.info('webrtc connection made: %s', "tilt server %s port %d " % (websocket.remote_address[0], websocket.remote_address[1], path), extra=d)
    print("starting phidgets on webrtc")
    tiltdata.level_table()
    try:
        while True:
            now = datetime.datetime.utcnow().isoformat() + 'Z'
            if (testgp and testgp.run()):
                outbound_message = testgp.nextAction()
                d = {'clientip': local_ip_address, 'user': 'pi' }
                logger.debug('sending test data: %s', "testgp next action=%s" % outbound_message, extra=d)
                try:
                    #await websocket.send(outbound_message)
                    conn.web.json_response(outbound_message)
                    conn.put_nowait(outbound_message)
                except Exception: #websockets.exceptions.ConnectionClosed:
                    d = {'clientip': local_ip_address, 'user': 'pi' }
                    logger.info('sending test data: %s', "client went away=%s" % outbound_message, extra=d)
                    break           
            if (tiltdata.gestureProcessor.run()):
                outbound_message = tiltdata.gestureProcessor.nextAction()
                d = {'clientip': local_ip_address, 'user': 'pi'}
                logger.debug('sending tilt data: %s', "tilt nextAction=%s" % outbound_message, extra=d)
                try:
                    #await websocket.send(outbound_message)
                    conn.put_nowait(outbound_message)
                except Exception: #websockets.exceptions.ConnectionClosed:
                    d = {'clientip': local_ip_address, 'user': 'pi' }
                    logger.debug('sending tilt data: %s', "client went away=%s" % outbound_message, extra=d)
                    break
            if (spindata.gestureProcessor.run()):
                outbound_message = spindata.gestureProcessor.nextAction()
                d = {'clientip': local_ip_address, 'user': 'pi' }
                logger.debug('sending spin data: %s', "spin gp nextAction=%s" % outbound_message, extra=d)
                try:
                    #await websocket.send(outbound_message)
                    conn.put_nowait(outbound_message)
                except Exception: #websockets.exceptions.ConnectionClosed:
                    d = {'clientip': local_ip_address, 'user': 'pi' }
                    logger.debug('sending spin data: %s', "client went away=%s" % outbound_message, extra=d)
                    break
            #await websocket.send(json.dumps(now))
            await asyncio.sleep(config['tiltSampleRate'])
    except  Exception: #websockets.exceptions.ConnectionResetError:
        d = {'clientip': local_ip_address, 'user': 'pi', }
        #logger.info('Websocket connection reset: %s', "tilt server %s port %d path %s" % (websocket.remote_address[0], websocket.remote_address[1], path), extra=d)
    d = {'clientip': local_ip_address, 'user': 'pi', }
    #logger.info('Websocket connection ended: %s', "tilt server %s port %d path %s" % (websocket.remote_address[0], websocket.remote_address[1], path), extra=d)

#start_server = websockets.serve(tilt, '127.0.0.1', 5678)
#start_server = websockets.serve(tilt, '192.168.1.73', 5678)
#start_server = websockets.serve(tilt, '10.21.48.122', 5678)
#  start_server = websockets.serve(tilt, local_ip_address, server_port)
#  asyncio.get_event_loop().run_until_complete(start_server)
#  try:
#      asyncio.get_event_loop().run_forever()
#  except:
#      d = {'clientip': local_ip_address, 'user': 'pi', }
#      logger.info('Uncaught error: %s', "%s" % (sys.exc_info()[0]))
  
 

@conn.subscribe
def onMessage(msg):  # Called when messages received from browser
    global running
    print("Got message:", msg)
    if not running:
        print("starting tilt process")
        running = True
        conn.put_nowait({"data": "pong"})
        print(asyncio.all_tasks())
        asyncio.ensure_future(tilt())
        #asyncio.get_event_loop().run_forever()
    
# Serve the RTCBot javascript library at /rtcbot.js
@routes.get("/rtcbot.js")
async def rtcbotjs(request):
    return web.Response(content_type="application/javascript", text=getRTCBotJS())

@routes.get("/geoconnectable.css")
async def rtcbotjs(request):
    return web.FileResponse('./web/geoconnectable.css')

@routes.get("/geoconnectable.js")
async def rtcbotjs(request):
    #script = with open("./web/geoconnectable.js", "r") as f:
    #    return f.read()
    #return web.Response(content_type="application/javascript", text=script)
    return web.FileResponse('./web/geoconnectable.js')

@routes.get("/mask.png")
async def rtcbotjs(request):
    return web.FileResponse('./web/mask.png')

@routes.get("/svg.js")
async def rtcbotjs(request):
    return web.FileResponse('./web/svg.js')



# This sets up the connection
@routes.post("/connect")
async def connect(request):
    clientOffer = await request.json()
    serverResponse = await conn.getLocalDescription(clientOffer)
    return web.json_response(serverResponse)


@routes.get("/")
async def index(request):
    return web.Response(
        content_type="text/html",
        text="""
    <html>
        <head>
            <title>GeoConnecTable</title> 
            <meta content="initial-scale=1.0, user-scalable=no" name="viewport" /> 
            <meta charset="utf-8" /> 
            <link rel="stylesheet" type="text/css" href="geoconnectable.css">
            <script src="./svg.js"></script>            
            <script src="/rtcbot.js"></script>
        </head>
        <body>
            
            <script>
                var rtcConnection = new rtcbot.RTCConnection();

                rtcConnection.subscribe(m => console.log("Received from python:", m));

                async function connect() {
                    let offer = await rtcConnection.getLocalDescription();

                    // POST the information to /connect
                    let response = await fetch("/connect", {
                        method: "POST",
                        cache: "no-cache",
                        body: JSON.stringify(offer)
                    });

                    await rtcConnection.setRemoteDescription(await response.json());
                    rtcConnection.put_nowait("Display connected!");

                    console.log("Ready!");
                }
                connect();


                  
            </script>
            <div id='buttons'>
      <button name="zoomin" onclick="zoomIn()">Zoom in</button>
      <button name="zoomout" onclick="zoomOut()">Zoom out</button>
      <br />
      <button name="connectlocal" onclick="connectLocal()">connect local</button>
      <button name="connectpi" onclick="connectPi()">connect pi</button>
      <button name="disconnectws" onclick="disconnectWS()">disconnect WS</button>
      </div>
    <div id="map-canvas"></div>
    <div id="map-mask"><img src="mask.png" width="1080" height="1080"/> </div>
   <script src="geoconnectable.js"></script>
    <script> function initialize()
    {
      // ugly scope hack
      initializemap();
    }
    </script>
    <script src="https://maps.googleapis.com/maps/api/js?v=3&key=AIzaSyD2YKbGfu2sbJl0ap0NnHQiZhBrNvrpKX8&callback=initialize"
    async defer></script>
   <div id="container" style="position: absolute;top: 0px;left: 422px;">
      <div id="circletext">
      </div>
    </div>
 
    <div class="instructions">
      <div class="spanish">
      </div>
      <div class="english">
      </div>
    </div> 
 
    <div class="instructions" id="site1">
      <img src="cedulas/Tilty 1.png" id="site1_img">
    </div>
    <div class="overview" id="site2">
      <img src="cedulas/Tilty 2.png" id="site2_img">
    </div>
    <div class="overview" id="site3">
      <img src="cedulas/Tilty 3.png" id="site3_img">
    </div> 

    <div class="overview" id="site4">
      <img src="cedulas/Tilty 4.png" id="site4_img">
    </div>  

    <div class="state" id="site5">
      <img src="cedulas/Tilty 5.png" id="site5_img">
      <div class="site_name">Sinaloa</div>
    </div>  


    <div class="state" id="site6">
      <img src="cedulas/Tilty 6.png" id="site6_img">
      <div class="site_name">Ciudad de México</div>
    </div>  

    <div class="state"  id="site7">
      <img src="cedulas/Tilty 7.png" id="site7_img">
      <div class="site_name">Veracruz de Ignacio de la Llave</div>
    </div>  

    <div class="state"  id="site8">
      <img src="cedulas/Tilty 8.png" id="site8_img">
      <div class="site_name">Chihuahua</div>
    </div>  

    <div class="state"  id="site9">
      <img src="cedulas/Tilty 9.png" id="site9_img">
      <div class="site_name">Guerrero</div>
    </div>  

    <div class="overview"  id="site10">
      <img src="cedulas/Tilty 10.png" id="site10_img">
      
    </div>  

    <div class="county"  id="site11">
      <img src="cedulas/Tilty 11.png" id="site11_img">
      <div class="site_name">Ahome</div>
    </div>  

    <div class="county"  id="site12">
      <img src="cedulas/Tilty 12.png" id="site12_img">
      <div class="site_name">Mazatlán</div>
    </div>  

    <div class="county"  id="site13">
      <img src="cedulas/Tilty 13.png" id="site13_img">
      <div class="site_name">Culiacán</div>
    </div>  

    <div class="county"  id="site14">
      <img src="cedulas/Tilty 14.png" id="site14_img">
      <div class="site_name">Badiguarato</div>
    </div>  

    <div class="county"  id="site15">incue
      <img src="cedulas/Tilty 15.png" id="site15_img">
      <div class="site_name">Salvador Alvarado (Guamúchil)</div>
    </div>  
    </div>  

    <div class="overview"  id="site16">
      <img src="cedulas/Tilty 16.png" id="site16_img">
    </div>  


    <div class="city" id="site17">
      <img src="cedulas/Tilty 17.png" id="site17_img">
      <div class="site_name">La Central (Los Mochis)</div>
    </div>  
    <div id='dashboard'>
      <div class='number' id='tiltdatarate'></div>
      <div class='number' id='spindatarate'></div>
      <div id='zoomer'>
        <div class='number' id='rotation'></div>
        <div id='EncoderID'></div>
        <div id='EncoderIndex'></div>
        <div id='EncoderDelta'></div>
        <div id='EncoderElapsedTime'></div>
        <div id='EncoderPosition'></div>
      </div>
      <div id='tilter'>
        <div class='numberpair' id='accelerometer'></div>
        <div id='TiltsensorID'></div>
        <div id='TiltX'></div>
        <div id='TiltY'></div>
        <div id='TiltMagnitude'></div>
      </div>
    </div>
<ul id="messages"></ul>  
        </body>
    </html>
    """)


async def cleanup(app=None):
    print("closing connection")
    await conn.close()


app = web.Application()
app.add_routes(routes)
app.add_routes([web.static('/cedulas', './web/cedulas')])
app.add_routes([web.static('/postcards', './web/postcards')])
app.on_shutdown.append(cleanup)
web.run_app(app)
