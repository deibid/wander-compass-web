let turf = require('@turf/turf');
// import * as turf from '@turf/turf';
// import {nearestPointOnLine} from '@turf/nearest-point-on-line';
const _mapFeatures = require('./data/mapFeatures-2');
const events = require('./events');


let io;

//Distance in meters between a location point and the center of the street to count it as walked
const TOLERANCE_RADIUS_FOR_STREET_WALKED = 2.5;

//Size of the hotspots at every intersection in meters
const RADIUS_FOR_INTERSECTION_BUFFER = 20 / 1000;

//Distance to walk from the intersection into a street. Used for directions. (In kilometers)
const DISTANCE_FROM_INTERSECTION_FOR_BEARING = 5 / 1000;

let point1 = turf.point([-73.995044, 40.729716]);

let mStreetLines = getStreetLines(_mapFeatures);
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



module.exports.attachIO = function (_io) {
  io = _io;
}

module.exports.test = () => {
  // console.log("Test function form another module");
}


module.exports.onNewLocation = function (msg) {


  //get a MapBox object with coordinates
  // let liveLocation = liveLocationMarker.getLngLat();

  //Parse and create a Turf.js Point with the new location data
  let liveLng = msg.lng;
  let liveLat = msg.lat;
  let liveLocationPoint = turf.point([liveLng, liveLat]);


  //Get the closest line on a MapBox street from the Point
  //Find the nearest point inside a street to snap to

  let closestStreet = closestLineToPoint(liveLocationPoint, _mapFeatures);

  // let closestStreet = closestLineToPoint(liveLocationPoint, mStreetLines);
  let snappedLocation = turf.nearestPointOnLine(closestStreet, liveLocationPoint, { 'units': 'kilometers' });

  let markers = {
    'real': turf.getCoords(liveLocationPoint),
    'snapped': turf.getCoords(snappedLocation)
  };
  io.emit(events.SEND_LOCATION_MARKERS, markers);

  let streetName = getFeatureName(closestStreet);
  io.emit(events.DISPLAY_STREET, streetName);


  //Show the snapped point on the MapBox map
  // snappedLocationMarker.setLngLat(turf.getCoords(snappedLocation));

  let snappedLocationCoords = turf.getCoords(snappedLocation);
  // console.log(`snapped Location Coords ${snappedLocationCoords}`);

  io.emit(events.DISPLAY_LOCATION, snappedLocationCoords);
  // UI.displayLocation(snappedLocationMarker.getLngLat());


  let lineCenter = turf.center(closestStreet);
  showStreetCenter(lineCenter);

  if (Math.abs(distanceBetween(lineCenter, snappedLocation)) < TOLERANCE_RADIUS_FOR_STREET_WALKED) {
    walkStreet(closestStreet);
  }

  showWalkedStreets();

  findIntersectionBuffers(closestStreet);
  showIntersectionBuffers(closestStreet);

  let containingBuffer = findContainingBuffer(snappedLocation);
  if (containingBuffer !== undefined) {
    // UI.displayActiveIntersection(getFeatureName(containingBuffer));
    io.emit(events.DISPLAY_ACTIVE_BUFFER, getFeatureName(containingBuffer));

    // let directions = {
    //   "bufferName": getFeatureName(containingBuffer),
    //   "directions": {
    //     "right": true,
    //     "left": false,
    //     "straight": true
    //   }
    // };

    // io.emit(events.SEND_DIRECTIONS, directions);


    // ARREGLAR ESTO
    // enteredIntersectionBuffer(containingBuffer, closestStreet);
  }


  //A lo mejor hay errores de logica en eventos de entrar o salir del buffer. Eso se arregla con los ifs de esta seccion

  //Enter buffer
  if (!mWasInBuffer && containingBuffer !== undefined) {

    enteredIntersectionBuffer(containingBuffer, closestStreet);




  }

  //Exit buffer
  if (mWasInBuffer && containingBuffer === undefined) {
    // console.log(`Exited Buffer`);
    mWasInBuffer = false;
    // UI.displayActiveIntersection("-");
  }
}


function enteredIntersectionBuffer(buffer, fromStreet) {

  // console.log(`Entered Buffer ${toString(buffer)}`);
  // console.log(`From street_.     ${toString(fromStreet)}`);

  let availableStreets = getAvailableStreetsForDirections(mStreetsWalked, buffer);
  // let directions = calculateDirectionsViaCenters(availableStreets, fromStreet);

  let directions = calculateDirectionsViaHardData(availableStreets, fromStreet);
  let command = convertDirectionsToCommand(directions);

  // console.log(`Estoy a punto de mandar al android ${toString(command)}`);
  //Send a command to the phone if there are available streets
  if (command !== -1) {
    io.emit(events.SEND_DIRECTIONS, command);
  }



  mWasInBuffer = true;
}

function convertDirectionsToCommand(directions) {


  let commandString = "";

  directions.forEach(d => {

    if (!d.walked) {
      let orientationKey = getOrientationKey(d.orientation);
      // console.log(`Orientation KEY rest- >>> ${orientationKey}`);
      commandString = commandString.concat(orientationKey);
      // console.log(`COmmand string ->        ${commandString}`);
    }
  });


  if (commandString === "") return -1;


  let finalCommand = getRandomTurnForDirection(commandString);

  let instruction = {
    "to": finalCommand
  }
  // console.log(`Random command ->>>>   \n${toString(instruction)}`);
  return instruction;


}

function getRandomTurnForDirection(commandString) {


  let options = commandString.length;
  let randomIndex = Math.floor(Math.random() * options);

  // console.log(`The random index is_> ${randomIndex}`);
  return commandString.charAt(randomIndex);


}

function getOrientationKey(orientation) {

  // console.log(`Get orientation Key -> ${orientation}`);

  switch (orientation) {
    case "left":
      return "0";
    case "straight":
      return "1";
    case "right":
      return "2";
    case "back":
      return "3"

  }


}

function calculateDirectionsViaHardData(availableStreets, fromStreet) {

  let fromStreetName = getFeatureName(fromStreet);

  // console.log(`Estoy por determinar la direccoin. Las calles disponibles son::::::\n\n\n\n${toString(availableStreets)}`);


  let directions = [];

  availableStreets.forEach(street => {

    // console.log(`from Street Name -> ${fromStreetName} `);
    // console.log(`Street to analyze \n\n${toString(street)}`);

    let streetName = getFeatureName(street);

    let orientation = (streetName === fromStreetName) ? "back" : street.properties.orientation[fromStreetName];
    // let orientation = street.properties.orientation.fromStreetName;
    let walked = mStreetsWalked.features.includes(street);

    let obj = {
      "streetName": streetName,
      "orientation": orientation,
      "walked": walked
    };
    //Only add the street as an option if it isn't to go back. Maybe someday I'll add another functionality to do this.
    if (orientation !== "back") {
      directions.push(obj);
    }

  });


  // console.log(`Las instrucciones finales son::: \n\n${toString(directions)}`);

  return directions;


}

function calculateDirectionsViaCenters(availableStreets, fromStreet) {

  //calulcar centros.
  //Hacer analisis de angulo con bearing
  //armar objecto
  //mandar hacia telefono

  let streetCenters = getCentersForStreetAtIntersections(availableStreets, fromStreet);
  // console.log(`Los centros son: \m ${toString(streetCenters)}`);

  let fromStreetCenter = turf.getCoord(turf.center(fromStreet));

  // let temp = streetCenters[1];
  // streetCenters[1] = streetCenters[2];
  // streetCenters[2] = temp;

  let sorted = streetCenters.sort((a, b) => {
    return a.properties.angle - b.properties.angle;
  });

  // console.log(`SORTED:_>   ${toString(sorted)}`);

  // sorted.forEach(street => {
  //   console.log(`STREET TO ASSIGN    ${toString(street)}`);
  //   let walked = mStreetsWalked.features.includes(street);
  //   street.walked = walked;
  // });


  // console.log(`Street with angle and status  ${toString(sorted)}`);
  let directions = {};


  // streetCenters.forEach(center => {




  // });







}


function getCentersForStreetAtIntersections(availableStreets, fromStreet) {

  let streetCenters = [];

  availableStreets.forEach(street => {

    if (getFeatureName(fromStreet) !== getFeatureName(street)) {
      let name = getFeatureName(street);
      let center = turf.center(street);
      center.properties.name = name;

      let walked = mStreetsWalked.features.includes(street);
      center.properties.walked = walked;

      let angle = turf.bearing(turf.center(fromStreet), turf.center(street));
      center.properties.angle = angle;

      center.properties.direction = getOrientationForAngle(angle);


      streetCenters.push(center);
      // let obj = {
      //   // "name": name,
      //   "center": turf;
      // };
      // streetCenters.centers.push(obj);
    }
  });
  return streetCenters;
}




function getOrientationForAngle(angle) {


  if (angle > 0) {


  }


  if (angle < 0) {

    if (angle < 0 && angle >= -30) {
      return "right";
    } else if (angle < -30 && angle >= -80) {
      return "straight";
    } else if (angle < -80) {
      return "left";
    }

  }





}

function getAvailableStreetsForDirections(streetsWalked, containingBuffer) {


  let availableStreets = [];

  let streetNamesAtIntersection = containingBuffer.properties.streets;
  streetNamesAtIntersection.forEach(name => {
    let street = getStreetByName(name);
    availableStreets.push(street);
  });



  let temp = availableStreets.filter(street => !mStreetsWalked.features.includes(street));
  // console.log(`Las calles NO caminadas para la interseccion ${containingBuffer.properties.name} son:__>   \n${toString(temp)}`);


  let names = "";
  temp.forEach(street => {
    names += street.properties.name + " ";
  });

  // UI.displayAvailableStreets(names);
  io.emit(events.DISPLAY_AVAILABLE_STREETS, names);

  //Actualmente estoy regresando todas las calles en alguna interseccion dada, sin importar si ya la caminaste o no.
  return availableStreets;

}

// function getStreetsForIntersection(containingBuffer) {

// }

function getPossibleStreetsNames(containingBuffer) {

  return containingBuffer.properties.streets;


}

function getWalkedStreetNames() {

  let streetsWalked_Names = [];
  mStreetsWalked.featureEach((street, index) => {
    streetsWalked_Names.push(street.properties.name);
  });

  return streetsWalked_Names;

}
function getAvailableStreets() {

  let streetsWalkedNames = [];

  turf.featureEach(mStreetsWalked, (currentFeature, futureIndex) => {
    // console.log(`Esta calle ya se camino ${toString(currentFeature)}`);
    let name = currentFeature.properties.name;
    if (streetsWalkedNames.indexOf(name) === -1)
      streetsWalkedNames.push(currentFeature.properties.name);
  });

  let availableStreetsForIntersection = mActiveBuffer.properties.streets;
  let streetsNotWalked = availableStreetsForIntersection.filter(streetName => streetsWalkedNames.indexOf(streetName) !== 1);
  // console.log(`Las calles disponibles para la interseccion ${mActiveBuffer.properties.name} son: ${streetsNotWalked}`);

}


function findContainingBuffer(snappedLocation) {

  let bufferA = mActiveIntersectionBuffers.features[0];
  let bufferB = mActiveIntersectionBuffers.features[1];

  let insideA = turf.booleanContains(bufferA, snappedLocation);
  let insideB = turf.booleanContains(bufferB, snappedLocation);


  if (insideA) {
    return bufferA;
  } else if (insideB) {
    return bufferB;
  } else {
    return undefined;
  }

}

function findIntersectionBuffers(street) {

  //find the Points from the collection that match the street that is being walked
  let streetIntersections = getIntersectionsForStreet(street);

  let pointA = streetIntersections[0];
  let pointB = streetIntersections[1];

  // console.log(`Antes de hacer el buffer. Los puntos son: __> ${toString(pointA)} \n y ${toString(pointB)}`)


  let bufferA = turf.buffer(pointA, RADIUS_FOR_INTERSECTION_BUFFER, { 'units': 'kilometers' });
  let bufferB = turf.buffer(pointB, RADIUS_FOR_INTERSECTION_BUFFER, { 'units': 'kilometers' });


  let result = turf.featureCollection([bufferA, bufferB]);

  mActiveIntersectionBuffers = result;


}


function showIntersectionBuffers() {
  io.emit(events.DISPLAY_INTERSECTION_BUFFERS, mActiveIntersectionBuffers);
  // map.getSource('intersectionBuffers').setData(mActiveIntersectionBuffers);
}

/**
* Finds the two Point features that correspond to that street
* @param {Street being walked} street 
*/
function getIntersectionsForStreet(street) {


  // console.log(`getIntersectionForStreet`);
  // console.log(`Street Name ${toString(street)}`);
  // console.log(`mIntersections ${toString(mIntersections)}`);
  let streetName = street.properties.name;
  let streetIntersections = [];
  mIntersections.features.forEach(intersection => {
    if (intersection.properties.streets.indexOf(streetName) !== -1) {
      streetIntersections.push(intersection);
    };
  });

  return streetIntersections;
}


function showStreetCenter(point) {

  mActiveStreetCenter.geometry.coordinates = turf.getCoord(point);
  // map.getSource('streetCenter').setData(mActiveStreetCenter);
  io.emit(events.SHOW_STREET_CENTER, mActiveStreetCenter);

}

//Update the layer data to show the saved streets
function showWalkedStreets() {
  // console.log(`show walked streets ${toString(mStreetsWalked)}`);
  io.emit(events.DISPLAY_WALKED_STREETS, mStreetsWalked);
  // map.getSource('walkedStreets').setData(mStreetsWalked);
}



//Save street in walked database
function walkStreet(street) {

  //If streets is not walked, add it to db.
  //TODO replace this with API endpoint
  if (mStreetsWalked.features.indexOf(street) === -1)
    mStreetsWalked.features.push(street);
}




// let i = 0;
// let points = turf.getCoords(multiPoints);

// map.on('click', (e) => {
//     let p = points[i];
//     liveLocationMarker.setLngLat(p);
//     i++;
//     if (i >= points.length)
//         i = 0;

//     let closestLine = closestLineToPoint(p, _mapFeatures);
//     let snapped = turf.nearestPointOnLine(closestLine, p, { 'units': 'meters' });

//     snappedLocationMarker.setLngLat(turf.getCoords(snapped));


// });


function closestLineToPoint(_point, _mapFeatures) {

  let closestLine;
  let shortestDistance = 1000;

  // console.log("antes de revisar");
  // console.log(`mStreetLines:> ${toString(mStreetLines)}`);
  turf.featureEach(mStreetLines, (currentLine, lineIndex) => {
    // console.log("Estoy revisando");
    let currentDistance = turf.pointToLineDistance(_point, currentLine, { 'units': 'meters' });
    if (currentDistance < shortestDistance) {
      closestLine = currentLine;
      shortestDistance = currentDistance;
    }
  });

  return closestLine;
}


function getFeatureName(feature) {
  return feature.properties.name;
}


function getStreetByName(name) {


  let street;
  mStreetLines.features.forEach(_street => {
    // console.log(`Probando ${toString(_street)}`)
    if (_street.properties.name === name) {
      // console.log(`Paso la prueba`);
      street = _street;
    }
  });

  return street;


}


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


  // _mapFeatures.features.forEach((currentFeature) => {
  //   // if (turf.getType(currentFeature) === 'LineString') {
  //   //   streetLines.features.push(currentFeature);
  //   // }

  //   if (currentFeature.type === 'LineString') {
  //     streetLines.features.push(currentFeature);
  //   }

  // });

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

function distanceBetween(point1, point2) {
  let distance = turf.distance(point1, point2, { options: 'kilometers' }) * 1000;
  return distance;
}



