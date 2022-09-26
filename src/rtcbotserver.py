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
                    default=['warning'],
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
                    default=0.01,
                    help='delay (in seconds?) to wait between sending message sets')
parser.add_argument('--tiltThreshold', 
                    type=float, dest='tiltThreshold',
                    default=0.002,
                    help='minimum accelerometer deflection from 0 to register as tilt')
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
websocket_logger.setLevel(logging.ERROR)
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
conn = RTCConnection()

    
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
                logger.info('sending test data: %s', "testgp next action=%s" % outbound_message, extra=d)
                try:
                    #await websocket.send(outbound_message)
                    conn.put_nowait(outbound_message)
                except Exception: #websockets.exceptions.ConnectionClosed:
                    d = {'clientip': local_ip_address, 'user': 'pi' }
                    logger.info('sending test data: %s', "client went away=%s" % outbound_message, extra=d)
                    break           
            if (tiltdata.gestureProcessor.run()):
                outbound_message = tiltdata.gestureProcessor.nextAction()
                d = {'clientip': local_ip_address, 'user': 'pi'}
                logger.info('sending tilt data: %s', "tilt nextAction=%s" % outbound_message, extra=d)
                try:
                    #await websocket.send(outbound_message)
                    conn.put_nowait(outbound_message)
                except Exception: #websockets.exceptions.ConnectionClosed:
                    d = {'clientip': local_ip_address, 'user': 'pi' }
                    logger.info('sending tilt data: %s', "client went away=%s" % outbound_message, extra=d)
                    break
            if (spindata.gestureProcessor.run()):
                outbound_message = spindata.gestureProcessor.nextAction()
                d = {'clientip': local_ip_address, 'user': 'pi' }
                logger.info('sending spin data: %s', "spin gp nextAction=%s" % outbound_message, extra=d)
                try:
                    #await websocket.send(outbound_message)
                    conn.put_nowait(outbound_message)
                except Exception: #websockets.exceptions.ConnectionClosed:
                    d = {'clientip': local_ip_address, 'user': 'pi' }
                    logger.info('sending spin data: %s', "client went away=%s" % outbound_message, extra=d)
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
    print("Got message:", msg["data"])
    conn.put_nowait({"data": "pong"})
    asyncio.ensure_future(tilt())
    asyncio.get_event_loop().run_forever()
    
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
    return web.Response(
        content_type="text/html",
        text="""
    <html>
        <head>
            <title>RTCBot: Data Channel</title>
            <script src="/rtcbot.js"></script>
        </head>
        <body style="text-align: center;padding-top: 30px;">
            <h1>Click the Button</h1>
            <button type="button" id="mybutton">Click me!</button>
            <p>
            Open the browser's developer tools to see console messages (CTRL+SHIFT+C)
            </p>
            <script>
                var conn = new rtcbot.RTCConnection();
                conn.subscribe((m) => console.log("Received from python:", m));

                async function connect() {
                    let offer = await conn.getLocalDescription();

                    // POST the information to /connect
                    let response = await fetch("/connect", {
                        method: "POST",
                        cache: "no-cache",
                        body: JSON.stringify(offer)
                    });

                    await conn.setRemoteDescription(await response.json());

                    console.log("Ready!");
                }
                connect();


                var mybutton = document.querySelector("#mybutton");
                mybutton.onclick = function () {
                    conn.put_nowait({ data: "ping" });
                };
            </script>
        </body>
    </html>
    """)

async def cleanup(app=None):
    await conn.close()


app = web.Application()
app.add_routes(routes)
app.on_shutdown.append(cleanup)
web.run_app(app)
