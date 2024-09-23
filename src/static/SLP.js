/* SLP Tilty Table is an interactive tour of nature reserves in Mexico. 


*/

/* for each zoom layer (larger is closer to earth) define the visibility of various eleents
    through a set of key:value pairs

A value of true for a key indicates it is a hotspot with visual content. 
    Upon reaching that zoom level (by spinning) the <div> with id=key will be made visible 
    and the map will be panned to the corresponding 'hotspot' These divs are defined in 
    the html file and are of the form
    <div class="instructions" id="site1">
      <img src="cedulas/Tilty 1.png" id="site1_img">
    </div>
 
A value of false for a key indicates it is a region of interest that can be shown via a 
  shapefile in GeoJson format which will be turned on at that particular zoom level.

A string value for a key indicates the index to a hotspot that should be indicated  at this zoom level

*/




/* regions of interest */

var features = {

}

var targetColor = '#ff0000';
var currentZoom = 0;
var targetRectangle;
var currentScale = 1.0;
var mapData = [];
var currentSpinPosition = 0;

// General globals
var ws;

var messages = document.createElement('ul');
var jsonData;

var loadedFeatures = [];

var floatZoom = 14.0;
var mexicoFullZoom = 5;
var idleTimer;
var map;
var ignoreKeys = ['pannable','mapZoom','imageSequenceLayer',
'spinInstruction', 'tiltInstruction', 'showLabels',
'imageSequenceLayer' ];


var hotspot = {};

var lastZoom = -1;

function setInstructions(texta, textb) 
{
  var element = document.getElementById("circletext");
  element.innerHTML = "";
  var instructions = SVG('circletext');
  instructions.size(1070,1070).center(540,540);
  var defs = instructions.defs();
  /*var guide = instructions.group();
  guide.circle(1080).fill({ color: '#f06', opacity: 0.4 });
  guide.line(540, 0, 540, 1080).fill({ color: '#fff', opacity: 0.6 }).stroke({ width: 1 })
  guide.line(0, 540, 1080, 540).fill({ color: '#fff', opacity: 0.6 }).stroke({ width: 1 })
  */
  // rx ry x-axis-rotation large-arc-flag sweep-flag dx dy
  var topArcPath = "   M 1040, 540   a 500,500  0 1 0   -1000,0 ";
  var bottomArcPath = "M   40, 540   a 500,500  0 1 0    1000,0 ";
  var leftArcPath  = " M  540, 40    a 500,500  0 1 0    0,1000 ";
  var rightArcPath = " M  540, 1040  a 500,500  0 1 0    0,-1000 ";

  var topGroup = instructions.group();
  topGroup.path(topArcPath).fill("none");
  var topText = topGroup.text(texta).fill("#0f0");
  topText.path(topArcPath);

  var leftGroup = instructions.group();
  leftGroup.path(leftArcPath).fill("none");
  var leftText = leftGroup.text(textb).fill("#ff0");
  leftText.path(leftArcPath);

  var bottomGroup = instructions.group();
  bottomGroup.path(bottomArcPath).fill('none');
  var bottomText = bottomGroup.text(texta).fill("#0f0");
  bottomText.path(bottomArcPath);

  var rightGroup = instructions.group();
  rightGroup.path(rightArcPath).fill('none');
  var rightText = rightGroup.text(textb).fill("#ff0");
  rightText.path(rightArcPath);
}

var openCards = {};

function openCedula(featureKey, sequenceNumber)
{
  if (openCards[featureKey] && openCards[featureKey].indexOf(String(sequenceNumber)) > -1) return;
  var imgDiv = document.getElementById(featureKey);
  imgDiv.style.display = "block";
  for (var img = 0; img <  imgDiv.childNodes.length; img++) {
    if (0 === imgDiv.childNodes[img].nodeName.localeCompare("img", 'en', {'sensitivity': 'base'})) {
      if (imgDiv.childNodes[img].hasAttribute("sequencenumber")){
        if (imgDiv.childNodes[img].getAttribute("sequencenumber") == sequenceNumber)
        {
          //imgDiv.childNodes[img].classList.remove('imageOff');
          console.log("opening cedula " + featureKey);
          if (openCards[featureKey]) 
            openCards[featureKey].push(String(sequenceNumber));
          else
            openCards[featureKey] = [String(sequenceNumber)];
          imgDiv.childNodes[img].classList.add('imageOn');
          //break;
        } else {
          if (openCards[featureKey]) 
          {
            var index = openCards[featureKey].indexOf(imgDiv.childNodes[img].getAttribute("sequencenumber"));
            if (index > -1) {
              openCards[featureKey].splice(index, 1);
              imgDiv.childNodes[img].classList.remove('imageOn');
            }
          }
          //imgDiv.childNodes[img].classList.add('imageOff');
        }
      }
    }
  }
}

function closeCedulas()
{
  for (featureKey in openCards) {

    var imgDiv= document.getElementById(featureKey);
    imgDiv.style.display = "none";
    for (var img = 0; img <  imgDiv.childNodes.length; img++) 
    {
      if (0 === imgDiv.childNodes[img].nodeName.localeCompare("img", 'en', {'sensitivity': 'base'})) 
      {
        console.log("closing cedulas for", featureKey, imgDiv.childNodes[img].getAttribute("sequencenumber"));
        var index = openCards[featureKey].indexOf(imgDiv.childNodes[img].getAttribute("sequencenumber"));
        if (index > -1) {
          openCards[featureKey].splice(index, 1);
          if (openCards[featureKey].length == 0) delete openCards[featureKey];
          imgDiv.childNodes[img].classList.remove('imageOn');
        }        //imgDiv.childNodes[img].classList.add('imageOff');
      }
    }
  }
}

function doZoom(newLayer)
{
  // could get optimized to not unload a feture we know we are about to load
  //console.log("doZoom " + newLayer);
  if (newLayer === lastZoom) return;
  if (newLayer < 0) newLayer = 0;
  if (newLayer >= Object.keys(zoomLayers).length) newLayer = Object.keys(zoomLayers).length - 1;
  currentZoom = newLayer;
  console.log("leaving layer " + lastZoom + " at " + map.getCenter());
  if (lastZoom === -1)
  {
    // This can only happen when initializing
    nextFeatureSet = zoomLayers[newLayer];
    setInstructions(zoomLayers[newLayer]['spinInstruction'],zoomLayers[newLayer]['tiltInstruction']);
    for (featureKey in nextFeatureSet) 
    {
      if ( ignoreKeys.indexOf(featureKey) > -1 ) continue;
      if (  nextFeatureSet[featureKey] === true)
      {
        console.log("moving to " + hotspot[featureKey] + " and opening open cedula for layer " + featureKey + " in zoom layer " + lastZoom);
        //fly to hotspot[featureKey] and open the badge
        map.panTo(hotspot[featureKey]);
        if (currentFeatureSet.hasOwnProperty('imageSequenceLayer')) 
          openCedula(featureKey, nextFeatureSet['imageSequenceLayer']);
      } 
      else
      {
        // load/enable the shapefeature 
        // strings indicate markers to turn on
        if ( typeof(nextFeatureSet[featureKey]) === "string" )
        {
          if (hotspot[nextFeatureSet[featureKey]])
          {
            //console.log("lighting hotspot " + featureKey);
            if (nextFeatureSet.hasOwnProperty('showLabels'))
              hotspot[nextFeatureSet[featureKey]].setLabel(featureKey);
            else
              hotspot[nextFeatureSet[featureKey]].setLabel(null);
            hotspot[nextFeatureSet[featureKey]].setMap(map);
          }
          //else console.log(nextFeatureSet[featureKey] + " has no marker ");
        }
        else
          // false indicates a region of interest 
        {

          if (features[featureKey])

          {
            features[featureKey]['mapdata'].setMap(map);
            features[featureKey]['mapdata'].setStyle(features[featureKey]['style']);
          }
          //else console.log(featureKey + " has no mapdata ");
        }
      }
    }
    map.setZoom(Math.min(maxZoom,Math.max(minZoom,zoomLayers[newLayer]['mapZoom'])));
    //lastZoom = map.getZoom();
    lastZoom = newLayer;
    console.log("entered layer " + newLayer + " at " + map.getCenter());
    paintTarget();
    return;

  } 
  else
  { 
    currentFeatureSet = zoomLayers[lastZoom];
    nextFeatureSet = zoomLayers[newLayer];
    for (featureKey in currentFeatureSet)
    {
      if ( ignoreKeys.indexOf(featureKey) > -1) continue;
      if ( nextFeatureSet.hasOwnProperty('showLabels') === 
       currentFeatureSet.hasOwnProperty('showLabels') &&
       (currentFeatureSet[featureKey] === nextFeatureSet[featureKey]))
         continue;
      if ( currentFeatureSet[featureKey] === true)
      {
        console.log("closing open cedula for layer " + featureKey + " in zoom layer " + lastZoom);
      //document.getElementById(featureKey).style.display = "none";
      closeCedula(featureKey)
      } 
      else
      {
        //unload the feature
        if ( typeof(currentFeatureSet[featureKey]) === "string" )
        {
        //console.log("closing open cedula for site " + featureKey + " at " + currentFeatureSet[featureKey] + " in zoom layer " + lastZoom);
          if (hotspot[currentFeatureSet[featureKey] ])
          {
            console.log("killing hotspot " + featureKey);
            hotspot[currentFeatureSet[featureKey]].setLabel(null);
            hotspot[currentFeatureSet[featureKey] ].setMap(null);
          }

        }
        else
        {
          //map.data.remove(featureKey);
          if (features[featureKey])

          {              
              features[featureKey]['mapdata'].setMap(null);
          }
        }
      }
    }
    nextFeatureSet = zoomLayers[newLayer];
    setInstructions(zoomLayers[newLayer]['spinInstruction'],zoomLayers[newLayer]['tiltInstruction']);
    for (featureKey in nextFeatureSet) 
    {
      if ( ignoreKeys.indexOf(featureKey) > -1) continue;
      if ( nextFeatureSet.hasOwnProperty('showLabels') === 
       currentFeatureSet.hasOwnProperty('showLabels') &&
       (currentFeatureSet[featureKey] === nextFeatureSet[featureKey]))  continue;
      if (  nextFeatureSet[featureKey] === true)
      {
        console.log("moving to " + hotspot[featureKey] + " and opening open cedula for layer " + featureKey + " in zoom layer " + newLayer);
        //fly to hotspot[featureKey] and open the badge
        map.panTo(hotspot[featureKey].position);
        openCedula(featureKey,nextFeatureSet['imageSequenceLayer']);
      } 
      else
      {
        // load/enable the shapefeature 
        // strings indicate markers to turn on
        if ( typeof(nextFeatureSet[featureKey]) == "string" )
        {
          if (hotspot[nextFeatureSet[featureKey]])
          {
            console.log("lighting hotspot " + featureKey);
            if (nextFeatureSet.hasOwnProperty('showLabels'))
            {

              hotspot[nextFeatureSet[featureKey]].setLabel(makeLabel(featureKey));
            }  else
            hotspot[nextFeatureSet[featureKey]].setLabel(null);
            hotspot[nextFeatureSet[featureKey]].setMap(map);
          }
          //else console.log(nextFeatureSet[featureKey] + " has no marker ");
        }
        else
        // false indicates a region of interest 
        {  if (features[featureKey])
          {
            features[featureKey]['mapdata'].setMap(map);
            features[featureKey]['mapdata'].setStyle(features[featureKey]['style']);
          }
          //else console.log(featureKey + " has no mapdata ");
        }
      }
    }
  
    map.setZoom(Math.min(maxZoom,Math.max(minZoom,zoomLayers[newLayer]['mapZoom'])));
    //lastZoom = map.getZoom();
    lastZoom = newLayer;
  }
  console.log("entered layer " + newLayer + " at " + map.getCenter());
  paintTarget();
} 


function startIdleTimer() 
{
  idleTimer = setTimeout(function(){
    window.location.reload(1);
  }, 10 * 60 * 1000);
}

function restartIdleTimer() 
{
  clearTimeout(idleTimer);
  startIdleTimer();
}

function shapeloaded(newfeatures)
{
  for (feature in newfeatures) 
  {
    if (!features.hasOwnProperty(newfeatures[feature].f.NOMGEO))
    {
      data1 = new google.maps.Data();
      data1.add(newfeatures[feature]);
      features[newfeatures[feature].f.NOMGEO] = { 
        'style' : 
        { 
          fillColor: 'magenta',
          strokeWeight: 1
        },
        'mapdata': data1,
      }
    } 
  }          
}

function makeLabel(siteName) {
  var markerLabel = Object.assign({}, defaultMarkerLabel)
  markerLabel.text = siteName;

  return markerLabel;
}
function initializemap(WebRTConnection) {

  if (map == null) {
    var mapCanvas = document.getElementById('map-canvas');
    var mapOptions = {
      //center: mexicoCenter,
      center: myLatLng,
      zoom : minZoom,
      disableDefaultUI: true,
      backgroundColor: '#000000',
      mapTypeId: google.maps.MapTypeId.HYBRID,
    };
    //mapTypeId: google.maps.MapTypeId.HYBRID,
    map = new google.maps.Map(mapCanvas, mapOptions);
    //mapType = new google.maps.StyledMapType(mapStyle, styledMapOptions);
    //map.mapTypes.set('geoconnectable', mapType);
    //map.setMapTypeId('geoconnectable');
    map.data.setStyle({
      fillColor: 'yellow',
      strokeWeight: 1
    });
    featuresets = {} ;

    var marker = new google.maps.Marker({
      position: myLatLng,
      map: map,
      title: 'Click to zoom',
      icon: logoimage,
    });

    for (hotspotkey in hotspots)
    {
      var hotspotDiv = document.getElementById(hotspotkey);
      if (hotspotDiv === null) continue;
      var iconImage;
      if (hotspotDiv.hasAttribute("icon")) {
        iconImage = Object.assign({}, defaultIconImage);
        iconImage.url=hotspotDiv.getAttribute("icon");
        if (hotspotDiv.hasAttribute("labelOffset")) {
          var offsetJSON = hotspotDiv.getAttribute("labelOffset");
          var offsetData = JSON.parse(offsetJSON);
          iconImage.labelOffset = new google.maps.Point(offsetData.x, offsetData.y);
        }

      }
      
      var loc =  new google.maps.LatLng(hotspots[hotspotkey][0],hotspots[hotspotkey][1]);
      hotspot[hotspotkey] = new google.maps.Marker({
        position: loc,
        label: makeLabel(hotspotkey),
        icon: iconImage,
      });
    }
    map.data.addListener('addfeature', function(e) {
      var name = e.feature.getProperty("NOMGEO");
      if (! name ) 
      {
        name = e.feature.getProperty("NAME_FAO");
        if (! name ) name = "idunno";
      }
      featuresets[name] = e.feature;

    });
    
    
    map.addListener('zoom_changed', function()
    {
      console.log("got new zoom", map.getZoom(), zoomLayers[currentZoom]);
      //doZoom(map.getZoom());
      //map.data.forEach(function (feature) { map.data.remove(feature);});
    });
  //map.data.loadGeoJson('encuesta_intercensal_2015/shps/df/df_entidad.geojson', null, shapeloaded);
    //map.data.loadGeoJson('encuesta_intercensal_2015/shps/sin/sin_entidad.geojson');
    

    for ( feature in features)
    {
      data1 = new google.maps.Data();

      //console.log("loading " + feature);
      data1.loadGeoJson(features[feature]['geojson'], null, shapeloaded);
      features[feature]['mapdata'] = data1;
    }
    
    map.data.addListener('mouseover', function(event) {
      map.data.revertStyle();
      map.data.overrideStyle(event.feature, {strokeWeight: 8});
    });
    
    //map.panTo(mexicoCenter);
    //map.panTo(myLatLng);
    

    map.addListener('center_changed', function() {
    });

    marker.addListener('click', function() {
      map.setZoom(8);
      map.setCenter(marker.getPosition());
    });  
    targetRectangle =  new google.maps.Rectangle();
    doZoom(0);

  }
  try {
    WebRTConnection.subscribe(m => 
      handleWebSocketMessage(m));

    //connectLocal();
  } 
  catch(e)
  {
    console.log("failed to attach local web socket: " + e);
    //try 
    //{
      //connectLocal()
    //}
    //catch(e)
    //{
      //console.log("failed to attach remote web socket: " + e);
    //}
  } 
};

function paintTarget()
{
  if (currentZoom < 1) return;
  currView = map.getBounds();
  if (currView == undefined) return;
  currLeft = currView.getNorthEast().lng();
  currRight = currView.getSouthWest().lng();
  currTop = currView.getNorthEast().lat();
  currBottom = currView.getSouthWest().lat();
  currWidth = currLeft - currRight;
  currHeight = currTop - currBottom;
  currCenter = map.getCenter();
  hotBounds = new google.maps.LatLngBounds(
    {lat: currCenter.lat()-targetWidth*currHeight, lng: currCenter.lng()-targetWidth*currWidth},
    {lat: currCenter.lat()+targetWidth*currHeight, lng: currCenter.lng()+targetWidth*currWidth});

  var strokeOpacity = 0.0;
  var fillOpacity = 0.0;
  if (zoomLayers[currentZoom]['pannable'])
  {
    if (zoomLayers[currentZoom]['mapZoom'] > 10) {
      fillOpacity = 0.35;
    }
    strokeOpacity = 0.8;
    targetColor = '#ffaaaa';
    for (featureKey in currentFeatureSet)
    {
      if ( ignoreKeys.indexOf(featureKey) > -1) continue;
      if ( typeof(currentFeatureSet[featureKey]) == "string" )
      {
        if (hotspot[currentFeatureSet[featureKey]])
        {
          if (hotBounds.contains(hotspot[currentFeatureSet[featureKey]].position))
          {
            if (currentZoom < siteCardStartLayer)
              setInstructions(spinInToSeeCards, huntForHotSpotTiltInstruction);
            else if (currentZoom > siteCardStartLayer+2)
              setInstructions(spinOutToSeeCards, huntForHotSpotTiltInstruction);
            else 
              setInstructions(spinToSeeMoreCards, spinToSeeMoreCards);
            targetColor = '#aaffaa';
            break;
          }
          
        }
      }
    }
  }

  targetRectangle.setOptions({
    strokeColor: targetColor,
    strokeOpacity: strokeOpacity,
    strokeWeight: 2,
    fillColor: targetColor,
    fillOpacity: fillOpacity,
    map: map,
    bounds: {
      north: currCenter.lat()+targetWidth*currHeight,
      south: currCenter.lat()-targetWidth*currHeight,
      west: currCenter.lng()-targetWidth*currWidth,
      east: currCenter.lng()+targetWidth*currWidth
    }
  });


}

function connectLocal() 
{
  ws = new WebSocket("ws://192.168.1.73:5678/");
  ws.onmessage = handleWebSocketMessage;
  console.log("ws://192.168.1.73:5678");
}
function connectPi() 
{
  ws = new WebSocket("ws://192.168.2.2:5678/");
  ws.onmessage = handleWebSocketMessage;
  console.log("ws://192.168.2.2:5678");
  
}

function disconnectWS()
{
  ws.close();
}

function zoomIn() 
{
  //doZoom(currentZoom + 1);
  var dummyEvent = { 'data' : '{"gesture":"zoom", "vector" : { "delta" : 20 }}'};
  handleWebSocketMessage(dummyEvent);
}
function zoomOut() 
{
  //doZoom(currentZoom - 1);
  var dummyEvent = { 'data' : '{"gesture":"zoom", "vector" : { "delta" : -20 }}'};
  handleWebSocketMessage(dummyEvent);
  
}

var handleWebSocketMessage = function (event) 
{
  if (! map) return;
  currView = map.getBounds();
  if (currView === undefined) return;
  
  currRight = currView.getNorthEast().lng();
  currLeft = currView.getSouthWest().lng();
  currTop = currView.getNorthEast().lat();
  currBottom = currView.getSouthWest().lat();
  currWidth = Math.abs(currLeft - currRight);
  currHeight = Math.abs(currTop - currBottom);
  currCenter = map.getCenter();

  //jsonData = JSON.parse(event.data);
  jsonData = JSON.parse(event);
  currentFeatureSet = zoomLayers[lastZoom];
  if (jsonData.type == 'spin') {
    document.getElementById('EncoderID').innerHTML(jsonData.packet.sensorID);
    document.getElementById('EncoderIndex').innerHTML(jsonData.packet.encoderIndex);
    document.getElementById('EncoderDelta').innerHTML(jsonData.packet.encoderDelta);
    document.getElementById('EncoderElapsedTime').innerHTML(jsonData.packet.encoderElapsedTime);
    document.getElementById('EncoderPosition').innerHTML(jsonData.packet.encoderPosition);
  } else if (jsonData.type == 'tilt') {
    document.getElementById('TiltsensorID').innerHTML(jsonData.packet.sensorID);
    document.getElementById('TiltX').innerHTML(jsonData.packet.tiltX);
    document.getElementById('TiltY').innerHTML(jsonData.packet.tiltY);
    document.getElementById('TiltMagnitude').innerHTML(jsonData.packet.tiltMagnitude);
  } 
  else if (jsonData.gesture == 'pan') 
  {
    //var dampingZoom = map.getZoom()*minZoom/maxZoom;
    if (jsonData.vector.x == 0.0 && jsonData.vector.y == 0.0) return;  
    var zoomFudge = (minZoom + 7) +
    ((minZoom + 7) - (maxZoom-3 ))/(minZoom-maxZoom) *
    (map.getZoom()-minZoom);
            //Log.i("fudge", Double.toString(zoomFudge) + ":" +  Double.toString(mMap.getCameraPosition().zoom));
            var percentChangeInY = panScaler * jsonData.vector.y *zoomFudge/maxZoom;
            deltaY = currHeight * percentChangeInY;

            percentChangeInX = panScaler * jsonData.vector.x *zoomFudge/maxZoom;
            deltaX = currWidth * percentChangeInX;
    //console.log("sensor message: " + jsonData.type + "-" + jsonData.vector.x + "," +jsonData.vector.y);
    var newLat = currCenter.lat()+deltaY;
    var  nextPosition = new google.maps.LatLng(
      Math.min(Math.max(newLat, -89 + currHeight/2),89-currHeight/2),
      currCenter.lng() + deltaX);
    //var d = new Date();
    //console.log(d.getTime(),"moving to", nextPosition.lat(),",",nextPosition.lng(),"deltaX",deltaX,"rawx",jsonData.vector.x,"fudge",zoomFudge/maxZoom);
    if (zoomLayers[currentZoom]['pannable']) {
      //map.panTo(nextPosition);
      //console.log("panning to " + nextPosition);
      map.setCenter(nextPosition);
      restartIdleTimer();
    }
    paintTarget();
  } 
  else if (jsonData.gesture == 'zoom') 
  {

    currentSpinPosition += jsonData.vector.delta;
    //console.log(currentSpinPosition);
    //console.log("sensor message: " + jsonData.gesture + " " + jsonData.vector.delta + "; currentSpinPosition=" +currentSpinPosition);
    if (currentSpinPosition < 0) currentSpinPosition = 0;
    var proposedZoom =  Math.floor(currentSpinPosition/clicksPerZoomLevel);
    restartIdleTimer();

    if (proposedZoom != currentZoom) 
    {
      //console.log("zooming to " + proposedZoom);
      doZoom(Math.min(Object.keys(zoomLayers).length - 1, Math.max(0,proposedZoom))); 
    }
  }
  else if (jsonData.gesture == 'combo') 
  {
    // needs to use above
  } 
  else 
  { 
    // deal with mysterious messages
    messages = document.getElementsByTagName('ul')[0];
    var message = document.createElement('li');
    var content = document.createTextNode(event.data);
    message.appendChild(content);
    messages.appendChild(message);
  }

  // deal with hotspot
  hotBounds = new google.maps.LatLngBounds(
    {lat: currCenter.lat()-targetWidth*currHeight, 
      lng: currCenter.lng()-targetWidth*currWidth},
      {lat: currCenter.lat()+targetWidth*currHeight, 
        lng: currCenter.lng()+targetWidth*currWidth});
  var hotspotFound = false;
  for (featureKey in currentFeatureSet)
  {
    if ( ignoreKeys.indexOf(featureKey) > -1) continue;
    if ( typeof(currentFeatureSet[featureKey]) == "string" )
    {
      if (currentFeatureSet.hasOwnProperty('imageSequenceLayer') && 
       hotspot[currentFeatureSet[featureKey]])
      {
        if (hotBounds.contains(hotspot[currentFeatureSet[featureKey]].position))
        {
          if ( ! hotspotFound )
          {
            console.log("zoomed in on " + currentFeatureSet[featureKey] + " in " + hotBounds );
            openCedula(currentFeatureSet[featureKey],currentFeatureSet['imageSequenceLayer']);
            hotspotFound = true;
          }
          else
            console.log("would like to have zoomed in on " + ']'[featureKey] + " in " + hotBounds );

        }
      }
    }
  }
  if ( ! hotspotFound )
      
  {
    //console.log("zoomed in on something else. Closing " + currentFeatureSet[featureKey] + " not in " + hotBounds );
    closeCedulas();
  }
}

startIdleTimer();

