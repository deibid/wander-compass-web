let socket = io();

const EVENT_NEW_LOCATION = "new-location-from-phone";

const demoWalkPoints = [
  [-73.99361505820534, 40.72916288174916],
  [-73.99345800227826, 40.72934843442177],
  [-73.99333940611872, 40.72948854905974],
  [-73.99335270012688, 40.72962501078616],
  [-73.99364853517395, 40.7297718216948],
  [-73.99376536713392, 40.72982980064751],
  [-73.99395803991895, 40.72992541631889],
  [-73.99393410368494, 40.72991353773891],
  "straight",
  [-73.99414700316358, 40.73001878887299],
  [-73.99443761755607, 40.730161600701265],
];

function sendEvent() {
  let data = {
    "lng": -73.99493742619224,
    "lat": 40.729596062586786
  };
  socket.emit(EVENT_NEW_LOCATION, data);
}


let point1 = turf.point([-73.984304, 40.727956]);

// let mStreetLines = getStreetLines(_mapFeatures);
let mStreetLines = _mapFeatures;
let mIntersections = getIntersections(_mapFeatures);

let mActiveBuffer;
let mWasInBuffer = false;




let mStreetsWalked = {
  'type': 'FeatureCollection',
  'features': []
}

let mActiveStreetCenter = {
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": []
  },
}
let mActiveIntersectionBuffers = {
  'type': 'FeatureCollection',
  'features': []
}


mapboxgl.accessToken = 'pk.eyJ1IjoiZGF2aWRhemFyIiwiYSI6ImNqdWFrZnk5ODAzbjU0NHBncHMyZ2JpNXUifQ.Kbdt8hM8CJIIryBWPSXczQ';
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/davidazar/cjvjxl6tm1o7i1do4dk61ijhd',
  center: [-73.989429, 40.726187],
  zoom: 15.2
});



//Add the data layers when the map loads
map.on('load', () => {


  map.addLayer({
    "id": "walkedStreets",
    "type": "line",
    'paint': {
      'line-color': "rgba(36, 178, 31, 0.6)",
      'line-width': 8
    },
    'source': {
      'type': 'geojson',
      'data': mStreetsWalked
    },
  });


  map.addLayer({
    'id': 'streetCenter',
    'type': 'symbol',
    'source': {
      'type': 'geojson',
      'data': mActiveStreetCenter
    },
    'layout': {
      'icon-image': 'hospital-15'
    },
  });


  map.addLayer({
    'id': 'intersectionBuffers',
    'type': 'fill',
    'source': {
      'type': 'geojson',
      'data': mActiveIntersectionBuffers
    },
    'paint': {

      'fill-color': "#000000",
      'fill-opacity': 0.5

    }
  })
});



//Marker for live location
let liveLocationMarker = new mapboxgl.Marker({ draggable: 'true' })
  .setLngLat(point1.geometry.coordinates)
  .addTo(map);

//Marker for snapped location
let snappedLocationMarker = new mapboxgl.Marker({ "color": "#FA77C3" }).setLngLat([0, 0]).addTo(map);

//Add event listener for when dragging or receiving location from server
liveLocationMarker.on('drag', onNewLocation);


// Function executed when dragging. This will get changed to a live location pushed from the phone
function onNewLocation() {

  //get a MapBox object with coordinates
  let liveLocation = liveLocationMarker.getLngLat();

  //Parse and create a Turf.js Point with the new location data
  let liveLng = liveLocation.lng;
  let liveLat = liveLocation.lat;

  //Send location to server
  socket.emit("new-location-from-phone", { "lng": liveLng, "lat": liveLat });

}


function toString(Object) {
  return JSON.stringify(Object, null, null);
}


socket.on('new-location-from-phone', (msg) => {

  // console.log("New Location ->> ");
  // console.log(toString(msg));

});

socket.on("display-street", (msg) => {

  // console.log(`Street to display ${msg}`);
  UI.displayStreet(msg);
});

socket.on("display-location", (msg) => {
  // console.log(`display-location ${toString(msg)}`)
  UI.displayLocation(msg);
});

socket.on("show-street-center", (msg) => {
  // console.log(`sohw-street-center ${toString(msg)}`);
  mActiveStreetCenter = msg;
  map.getSource('streetCenter').setData(mActiveStreetCenter);
});

socket.on("display-walked-streets", (msg) => {
  // console.log(`Estoy en display walked`);
  mStreetsWalked = msg;
  map.getSource('walkedStreets').setData(mStreetsWalked);
});

socket.on("display-intersection-buffers", (msg) => {
  // console.log(`Estoy in display intersectoin buffers ${toString(msg)}`);
  mActiveIntersectionBuffers = msg;
  map.getSource('intersectionBuffers').setData(mActiveIntersectionBuffers);
});

socket.on("send-location-markers", (msg) => {

  let real = msg.real;
  let snapped = msg.snapped;

  liveLocationMarker.setLngLat(real);
  snappedLocationMarker.setLngLat(snapped);


});

socket.on('display-active-buffer', (msg) => {

  UI.displayActiveIntersection(msg);

});





socket.on('display-available-streets', (msg) => {
  UI.displayAvailableStreets(msg);
});
