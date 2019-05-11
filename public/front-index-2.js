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


  // let data = {
  //   "lng": -73.995044,
  //   "lat": 40.729716
  // };


  let data = {
    "lng": -73.99493742619224,
    "lat": 40.729596062586786
  };


  socket.emit(EVENT_NEW_LOCATION, data);
}



//Distance in meters between a location point and the center of the street to count it as walked
// const TOLERANCE_RADIUS_FOR_STREET_WALKED = 2.5;

//Size of the hotspots at every intersection in meters
// const RADIUS_FOR_INTERSECTION_BUFFER = 20 / 1000;

let point1 = turf.point([-73.984304, 40.727956]);


// let point2 = turf.point([-73.994886, 40.729189]);
// let point3 = turf.point([-73.993946, 40.729001]);
// let point4 = turf.point([-73.993494, 40.729629]);

// let multiPoints = turf.multiPoint([[-73.995044, 40.729716], [-73.994886, 40.729189], [-73.993946, 40.729001], [-73.993494, 40.729629]]);
let mStreetLines = getStreetLines(_mapFeatures);
let mIntersections = getIntersections(_mapFeatures);

let mActiveBuffer;
let mWasInBuffer = false;


// let angleP1 = turf.point([-73.983802, 40.729290]);
// let angleP2 = turf.point([-73.983885, 40.729520]);
// let angleP3 = turf.point([-73.984236, 40.729485]);
// let angleP4 = turf.point([-73.984156, 40.729175]);




// let angle = turf.rhumbBearing(angleP1, angleP2);
// let angle2 = turf.rhumbBearing(angleP1, angleP3);
// let angle3 = turf.rhumbBearing(angleP1, angleP4);

// console.log(`Angle 1-> ${angle}`);
// console.log(`Angle 2-> ${angle2}`);
// console.log(`Angle 3-> ${angle3}`);



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

// // //Map Setups
// mapboxgl.accessToken = 'pk.eyJ1IjoiZGF2aWRhemFyIiwiYSI6ImNqdWFrZnk5ODAzbjU0NHBncHMyZ2JpNXUifQ.Kbdt8hM8CJIIryBWPSXczQ';
// const map = new mapboxgl.Map({
//   container: 'map',
//   style: 'mapbox://styles/davidazar/cjukkxnww88nb1fqtgh1ovfmj',
//   center: [-73.99428794374874, 40.729277133361386],
//   zoom: 17,
//   dragPan: false
// });


mapboxgl.accessToken = 'pk.eyJ1IjoiZGF2aWRhemFyIiwiYSI6ImNqdWFrZnk5ODAzbjU0NHBncHMyZ2JpNXUifQ.Kbdt8hM8CJIIryBWPSXczQ';
const map = new mapboxgl.Map({
container: 'map',
style: 'mapbox://styles/davidazar/cjvjxl6tm1o7i1do4dk61ijhd',
center: [-73.989429, 40.726187],
zoom: 15.2
});



map.on('load', () => {
  //Add the walked streets layer
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
// liveLocationMarker.on('drag')//, onNewLocation);
liveLocationMarker.on('drag', onNewLocation);



// Function executed when dragging. This will get changed to a live location pushed from the phone
function onNewLocation() {

  // console.log("Drag");

  //get a MapBox object with coordinates
  let liveLocation = liveLocationMarker.getLngLat();

  //Parse and create a Turf.js Point with the new location data
  let liveLng = liveLocation.lng;
  let liveLat = liveLocation.lat;
  let liveLocationPoint = turf.point([liveLng, liveLat]);


  // console.log(`liveLocationPoint   ${toString(liveLocationPoint)}`);
  //Get the closest line on a MapBox street from the Point
  //Find the nearest point inside a street to snap to
  let closestStreet = closestLineToPoint(liveLocationPoint, _mapFeatures);
  let snappedLocation = turf.nearestPointOnLine(closestStreet, liveLocationPoint, { 'units': 'meters' });

  let snappedLng = turf.getCoord(snappedLocation)[0];
  let snappedLat = turf.getCoord(snappedLocation)[1];

  socket.emit("new-location-from-phone", { "lng": snappedLng, "lat": snappedLat });

  // UI.displayStreet(getFeatureName(closestStreet));

  // //Show the snapped point on the MapBox map
  // snappedLocationMarker.setLngLat(turf.getCoords(snappedLocation));

  // UI.displayLocation(snappedLocationMarker.getLngLat());


  // let lineCenter = turf.center(closestStreet);
  // showStreetCenter(lineCenter);

  // if (Math.abs(distanceBetween(lineCenter, snappedLocation)) < TOLERANCE_RADIUS_FOR_STREET_WALKED) {
  //   walkStreet(closestStreet);
  // }

  // showWalkedStreets();

  // findIntersectionBuffers(closestStreet);
  // showIntersectionBuffers(closestStreet);

  // let containingBuffer = findContainingBuffer(snappedLocation);
  // if (containingBuffer !== undefined)
  //   UI.displayActiveIntersection(getFeatureName(containingBuffer));

  // //Enter buffer
  // if (!mWasInBuffer && containingBuffer !== undefined) {
  //   console.log(`Entered Buffer ${toString(containingBuffer)}`);

  //   let availableStreets = getAvailableStreetsForDirections(mStreetsWalked, containingBuffer);
  //   mWasInBuffer = true;
  // }

  // //Exit buffer
  // if (mWasInBuffer && containingBuffer === undefined) {
  //   console.log(`Exited Buffer`);
  //   mWasInBuffer = false;
  //   UI.displayActiveIntersection("-");
  // }
}

// function getAvailableStreetsForDirections(streetsWalked, containingBuffer) {


//   let availableStreets = [];

//   let streetNamesAtIntersection = containingBuffer.properties.streets;
//   streetNamesAtIntersection.forEach(name => {
//     let street = getStreetByName(name);
//     availableStreets.push(street);
//   });



//   let temp = availableStreets.filter(street => !mStreetsWalked.features.includes(street));
//   console.log(`Las calles NO caminadas para la interseccion ${containingBuffer.properties.name} son:__>   \n${toString(temp)}`);


//   let names = "";
//   temp.forEach(street => {
//     names += street.properties.name + " ";
//   });

//   UI.displayAvailableStreets(names);

// }

// function getStreetsForIntersection(containingBuffer) {

// }

// function getPossibleStreetsNames(containingBuffer) {

// return containingBuffer.properties.streets;


// }

// function getWalkedStreetNames() {

//   let streetsWalked_Names = [];
//   mStreetsWalked.featureEach((street, index) => {
//     streetsWalked_Names.push(street.properties.name);
//   });

//   return streetsWalked_Names;

// }
// function getAvailableStreets() {

//   let streetsWalkedNames = [];

//   turf.featureEach(mStreetsWalked, (currentFeature, futureIndex) => {
//     console.log(`Esta calle ya se camino ${toString(currentFeature)}`);
//     let name = currentFeature.properties.name;
//     if (streetsWalkedNames.indexOf(name) === -1)
//       streetsWalkedNames.push(currentFeature.properties.name);
//   });

//   let availableStreetsForIntersection = mActiveBuffer.properties.streets;
//   let streetsNotWalked = availableStreetsForIntersection.filter(streetName => streetsWalkedNames.indexOf(streetName) !== 1);
//   console.log(`Las calles disponibles para la interseccion ${mActiveBuffer.properties.name} son: ${streetsNotWalked}`);

// }


// function findContainingBuffer(snappedLocation) {

//   let bufferA = mActiveIntersectionBuffers.features[0];
//   let bufferB = mActiveIntersectionBuffers.features[1];

//   let insideA = turf.booleanContains(bufferA, snappedLocation);
//   let insideB = turf.booleanContains(bufferB, snappedLocation);


//   if (insideA) {
//     return bufferA;
//   } else if (insideB) {
//     return bufferB;
//   } else {
//     return undefined;
//   }

// }


// function findIntersectionBuffers(street) {

//   //find the Points from the collection that match the street that is being walked
//   let streetIntersections = getIntersectionsForStreet(street);

//   let pointA = streetIntersections[0];
//   let pointB = streetIntersections[1];

//   // console.log(`Antes de hacer el buffer. Los puntos son: __> ${toString(pointA)} \n y ${toString(pointB)}`)


//   let bufferA = turf.buffer(pointA, RADIUS_FOR_INTERSECTION_BUFFER, { 'units': 'kilometers' });
//   let bufferB = turf.buffer(pointB, RADIUS_FOR_INTERSECTION_BUFFER, { 'units': 'kilometers' });


//   let result = turf.featureCollection([bufferA, bufferB]);

//   mActiveIntersectionBuffers = result;


// }


// function showIntersectionBuffers() {
//   map.getSource('intersectionBuffers').setData(mActiveIntersectionBuffers);
// }

// /**
//  * Finds the two Point features that correspond to that street
//  * @param {Street being walked} street 
//  */
// function getIntersectionsForStreet(street) {

//   let streetName = street.properties.name;
//   let streetIntersections = [];
//   mIntersections.features.forEach(intersection => {
//     if (intersection.properties.streets.indexOf(streetName) !== -1) {
//       streetIntersections.push(intersection);
//     };
//   });

//   return streetIntersections;
// }


// function showStreetCenter(point) {

//   mActiveStreetCenter.geometry.coordinates = turf.getCoord(point);
//   map.getSource('streetCenter').setData(mActiveStreetCenter);

// }

// //Update the layer data to show the saved streets
// function showWalkedStreets() {
//   map.getSource('walkedStreets').setData(mStreetsWalked);
// }



// //Save street in walked database
// function walkStreet(street) {

//   //If streets is not walked, add it to db.
//   //TODO replace this with API endpoint
//   if (mStreetsWalked.features.indexOf(street) === -1)
//     mStreetsWalked.features.push(street);
// }




// // let i = 0;
// // let points = turf.getCoords(multiPoints);

// // map.on('click', (e) => {
// //     let p = points[i];
// //     liveLocationMarker.setLngLat(p);
// //     i++;
// //     if (i >= points.length)
// //         i = 0;

// //     let closestLine = closestLineToPoint(p, _mapFeatures);
// //     let snapped = turf.nearestPointOnLine(closestLine, p, { 'units': 'meters' });

// //     snappedLocationMarker.setLngLat(turf.getCoords(snapped));


// // });


function closestLineToPoint(_point, _mapFeatures) {

  let closestLine;
  let shortestDistance = 1000;


  turf.featureEach(mStreetLines, (currentLine, lineIndex) => {
    let currentDistance = turf.pointToLineDistance(_point, currentLine, { 'units': 'meters' });
    if (currentDistance < shortestDistance) {
      closestLine = currentLine;
      shortestDistance = currentDistance;
    }
  });

  return closestLine;
}


// function getFeatureName(feature) {
//   return feature.properties.name;
// }


// function getStreetByName(name) {


//   let street;
//   mStreetLines.features.forEach(_street => {
//     // console.log(`Probando ${toString(_street)}`)
//     if (_street.properties.name === name) {
//       // console.log(`Paso la prueba`);
//       street = _street;
//     }
//   });

//   return street;


// }


function getStreetLines(_mapFeatures) {

  let streetLines = {
    'features': [],
    'type': "FeatureCollection"
  }

  turf.featureEach(_mapFeatures, (currentFeature, featureIndex) => {

    if (turf.getType(currentFeature) === 'LineString') {
      streetLines.features.push(currentFeature);
    }
  });

  return streetLines;
}

function getIntersections(_mapFeatures) {

  let intersections = {
    'features': [],
    'type': "FeatureCollection"
  }

  turf.featureEach(_mapFeatures, (currentFeature, featureIndex) => {

    if (turf.getType(currentFeature) === 'Point') {
      intersections.features.push(currentFeature);
    }
  });

  return intersections;
}



function toString(Object) {
  return JSON.stringify(Object, null, null);
}

// function distanceBetween(point1, point2) {
//   let distance = turf.distance(point1, point2, { options: 'kilometers' }) * 1000;
//   return distance;
// }


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

  snappedLocationMarker.setLngLat(snapped);
  // liveLocationMarker.setLngLat(real);

});

socket.on('display-active-buffer', (msg) => {

  UI.displayActiveIntersection(msg);

});

socket.on('display-available-streets', (msg) => {
  UI.displayAvailableStreets(msg);
})