let turf = require('@turf/turf');
const _mapFeatures = require('./data/mapFeatures-expanded');
const events = require('./events');
const orientation = require('./orientation');
const _ = require("underscore");


let io;

//Distance in meters between a location point and the center of the street to count it as walked
const TOLERANCE_RADIUS_FOR_STREET_WALKED = 5;

//Size of the hotspots at every intersection in meters
const RADIUS_FOR_INTERSECTION_BUFFER = 30 / 1000;

//Distance to walk from the intersection into a street. Used for directions. (In kilometers)
const DISTANCE_FROM_INTERSECTION_FOR_BEARING = 30 / 1000;


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


  //Create a Turf.js Point with the new location data
  let liveLocationPoint = turf.point([msg.lng, msg.lat]);

  //Find the closest street to the coordinate received
  let closestStreet = closestLineToPoint(liveLocationPoint, _mapFeatures);

  //Create a new snapped location to the closest street
  let snappedLocation = getSnappedLocation(liveLocationPoint);


  //(broadcast functions) - publish changes so that the web client can update the UI
  broadcastLocationMarkers(liveLocationPoint, snappedLocation);
  broadcastStreetName(closestStreet);
  broadcastLocationCoordinates(snappedLocation);

  let streetCenter = turf.center(closestStreet);
  broadcastStreetCenter(streetCenter);

  if (Math.abs(distanceBetween(streetCenter, snappedLocation)) < TOLERANCE_RADIUS_FOR_STREET_WALKED) {
    walkStreet(closestStreet);
  }

  broadcastWalkedStreets();

  mActiveIntersectionBuffers = getIntersectionBuffers(closestStreet);
  broadcastIntersectionBuffers();

  let containingBuffer = getContainingBuffer(snappedLocation);

  //Enter buffer event
  if (!mWasInBuffer && containingBuffer !== undefined) {
    console.log("Entered Buffer");
    mWasInBuffer = true;
    broadcastContainingBuffer(containingBuffer);
    enteredBuffer(containingBuffer, closestStreet);
  }

  //Exit buffer event
  if (mWasInBuffer && containingBuffer === undefined) {
    console.log(`Exited Buffer`);
    mWasInBuffer = false;
  }
}


function getSnappedLocation(point) {

  let closestStreet;
  let shortestDistance = 99999999;

  turf.featureEach(_mapFeatures, (currentLine, lineIndex) => {

    let currentDistance = turf.pointToLineDistance(point, currentLine, { 'units': 'meters' });
    if (currentDistance < shortestDistance) {
      closestStreet = currentLine;
      shortestDistance = currentDistance;
    }
  });


  return turf.nearestPointOnLine(closestStreet, point, { 'units': 'meters' });

}


function enteredBuffer(buffer, fromStreet) {


  //get the connected streets to the buffer
  let streetsConnectedToIntersection = getStreetsConnectedToIntersection(buffer);

  //calculate the directions of the available streets with regards of how you're entering the buffer
  let orientationOfConnectedStreets = getOrientationOfConnectedStreets(buffer, fromStreet, streetsConnectedToIntersection);

  let travelDirections = calculateCommandFromDirections(orientationOfConnectedStreets);
  let travelCommand = getFinalCommand(travelDirections);

  print("-----------");
  print(`Final Command ${travelCommand}\n`);

  broadcastTravelCommand(travelCommand);


  return;

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


function isSameStreet(street1, street2) {

  let s1 = {
    p1: turf.getCoords(street1)[0],
    p2: turf.getCoords(street1)[1]
  }

  let s2 = {
    p1: turf.getCoords(street2)[0],
    p2: turf.getCoords(street2)[1]
  }

  if (isSameCoords(s1.p1, s2.p1)) {
    if (isSameCoords(s1.p2, s2.p2)) {
      return true;
    }
  }

  if (isSameCoords(s1.p1, s2.p2)) {
    if (isSameCoords(s1.p2, s2.p1)) {
      return true;
    }
  }
  return false;
}



function getFinalCommand(travelDirections) {

  let randomIndex = Math.floor(Math.random() * travelDirections.length);
  return travelDirections[randomIndex];


}
function calculateCommandFromDirections(directions) {

  let commands = [];
  directions.forEach(d => {

    if (d === orientation.LEFT) commands.push('0');
    if (d === orientation.STRAIGHT) commands.push('1');
    if (d === orientation.RIGHT) commands.push('2');

  });

  return commands;

}

function getOrientationOfConnectedStreets(buffer, fromStreet, streetsConnectedToIntersection) {


  //generate a temporary street grid with the initial point being the same as the buffer

  let virtualStreets = getVirtualStreetsForIntersection(buffer, streetsConnectedToIntersection);
  let virtualFromStreet = convertStreetToVirtualStreet(buffer, fromStreet);

  let pointAlongFromStreet = turf.along(virtualFromStreet, DISTANCE_FROM_INTERSECTION_FOR_BEARING, { units: 'kilometers' });
  let bearings = [];

  turf.featureEach(virtualStreets, (street, index) => {
    //Dont calculate angles for the street you are walking on
    if (_.isEqual(virtualFromStreet, street)) {
      return;
    }

    if (streetIsWalked(buffer, street)) return;
    //Todo, Add filter for walked streets here:
    //......if(walkedStreet) return;

    let pointAlong = turf.along(street, DISTANCE_FROM_INTERSECTION_FOR_BEARING, { units: 'kilometers' });
    let bearing = turf.bearing(pointAlongFromStreet, pointAlong);
    bearings.push(bearing);

  });

  print('bearings');
  print(bearings);

  let travelDirection = getTravelDirection(buffer, virtualFromStreet);
  let bearingDirections = getDirectionsForBearings(travelDirection, bearings);

  print("bearing directions");
  print(bearingDirections);
  return bearingDirections;
}


function streetIsWalked(buffer, street) {

  let invertedStreet = getInvertedStreet(street);
  print("Checking if walked Street")
  print("Walked Streets");
  print(mStreetsWalked.features);

  print("Street")
  print(street);

  print("invertedStreet ");
  print(invertedStreet);



  let filteredByStreet = mStreetsWalked.features.filter(s => turf.getCoords(s)[0] === turf.getCoords(street)[0] || turf.getCoords(s)[1] === turf.getCoords(street)[1]);
  let filteredByInvertedStreet = mStreetsWalked.features.filter(s => turf.getCoords(s)[0] === turf.getCoords(invertedStreet)[0] || turf.getCoords(s)[1] === turf.getCoords(invertedStreet)[1]);

  print("filter by street length ");
  print(filteredByStreet.length);

  print("filter by inverted length ");
  print(filteredByInvertedStreet.length);

  print("------");
  return (filteredByStreet.length !== 0 || filteredByInvertedStreet.length !== 0);
  // return (mStreetsWalked.features.indexOf(street) !== -1 || mStreetsWalked.features.indexOf(invertedStreet) !== -1) ? true : false;

}


function getInvertedStreet(street) {

  let coords = turf.getCoords(street);
  let p1 = coords[0];
  let p2 = coords[1];

  return turf.lineString([p2, p1]);

}

function getDirectionsForBearings(travelDirections, bearings) {


  let directions = [];
  print("TRAVEL DIRECTIONS");
  print(travelDirections);
  bearings.forEach(bearing => {

    switch (travelDirections) {

      case orientation.NORTH:

        print("travel north");
        if (inRange(bearing, -15)) directions.push(orientation.LEFT);
        if (inRange(bearing, 29)) directions.push(orientation.STRAIGHT);
        if (inRange(bearing, -74)) directions.push(orientation.RIGHT);

        break;

      case orientation.EAST:

        if (inRange(bearing, 73)) directions.push(orientation.LEFT);
        if (inRange(bearing, 118)) directions.push(orientation.STRAIGHT);
        if (inRange(bearing, 164)) directions.push(orientation.RIGHT);

        break;

      case orientation.SOUTH:

        if (inRange(bearing, 163)) directions.push(orientation.LEFT);
        if (inRange(bearing, -150)) directions.push(orientation.STRAIGHT);
        if (inRange(bearing, -106)) directions.push(orientation.RIGHT);

        break;

      case orientation.WEST:

        if (inRange(bearing, -105)) directions.push(orientation.LEFT);
        if (inRange(bearing, -61)) directions.push(orientation.STRAIGHT);
        if (inRange(bearing, -16)) directions.push(orientation.RIGHT);
        break;

    }

  });
  return directions;
}



function inRange(number, centerOfRange) {
  let range = 5;
  return (Math.abs(number) <= Math.abs(centerOfRange) + range && Math.abs(number) >= Math.abs(centerOfRange) - range) ? true : false;
}



/**
 * 
 * @param {turf.buffer} buffer Intersection buffer to take as reference
 * @param {turf.lineString} street Street to orient with regards of buffer
 */
function convertStreetToVirtualStreet(buffer, street) {

  let bufferCenter = getBufferCenter(buffer);
  let commonCoords = turf.getCoord(bufferCenter);

  let streetCoords = turf.getCoords(street);
  // print("Converting to virtual street");
  // print(commonCoords);
  // print(streetCoords);
  // print("\n\n");
  let startPoint;
  let endPoint;

  if (commonCoords[0] === streetCoords[0][0] && commonCoords[1] === streetCoords[0][1]) {
    return street;
  } else {
    startPoint = streetCoords[1];
    endPoint = streetCoords[0];
    return turf.lineString([startPoint, endPoint]);
  }

}


/**
 * Creates a temporary street collection based on the streets connected to a given buffer.
 * The first coordinate of each street in this collection is the same as the center of the buffer
 * @param {Intersection buffer where user is standing in} buffer 
 * @param {Streets connected to that intersection} streetsConnectedToIntersection 
 */
function getVirtualStreetsForIntersection(buffer, streetsConnectedToIntersection) {

  let bufferCenter = getBufferCenter(buffer);
  let commonCoords = turf.getCoord(bufferCenter);

  let streets = [];


  //Flip the coordinates of the streets to start with the coordinate that matches the center of the buffer.
  turf.featureEach(streetsConnectedToIntersection, (street, index) => {
    let streetCoords = turf.getCoords(street);
    let p1 = streetCoords[0];
    let p2 = streetCoords[1];

    let startingCoords;
    let endingCoords;

    if (isSameCoords(commonCoords, p1)) {
      startingCoords = p1;
      endingCoords = p2;
    } else {
      startingCoords = p2;
      endingCoords = p1;
    }
    streets.push(turf.lineString([startingCoords, endingCoords]));
  });


  return turf.featureCollection(streets);

}



function getStreetsConnectedToIntersection(buffer) {

  //get buffer coords.
  //compare against everything and see what can be found.

  let bufferCenter = getBufferCenter(buffer);
  let bufferCenterCoords = turf.getCoord(bufferCenter);

  let connectedStreets = [];

  turf.featureEach(_mapFeatures, (street, index) => {

    let streetCoords = turf.getCoords(street);
    let streetP1 = streetCoords[0];
    let streetP2 = streetCoords[1];

    if (isSameCoords(streetP1, bufferCenterCoords) || isSameCoords(streetP2, bufferCenterCoords)) {
      connectedStreets.push(street);
    }
  });

  return turf.featureCollection(connectedStreets);

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


function getContainingBuffer(snappedLocation) {

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

function getIntersectionBuffers(street) {


  // console.log(`findIntersectionBuffers\ncalle->> ${toString(street)}`);

  //find the Points from the collection that match the street that is being walked
  // let streetIntersections = getIntersectionsForStreetByName(street);
  let streetIntersections = getStreetCornerPoints(street);

  let pointA = streetIntersections[0];
  let pointB = streetIntersections[1];

  // console.log(`Antes de hacer el buffer. Los puntos son: __> ${toString(pointA)} \n y ${toString(pointB)}`)


  let bufferA = turf.buffer(pointA, RADIUS_FOR_INTERSECTION_BUFFER, { 'units': 'kilometers' });
  let bufferB = turf.buffer(pointB, RADIUS_FOR_INTERSECTION_BUFFER, { 'units': 'kilometers' });



  let result = turf.featureCollection([bufferA, bufferB]);

  return result;


}






/**
* Finds the two Point features that correspond to that street
* @param {Street being walked} street 
*/
function getStreetCornerPoints(street) {


  let coords = turf.getCoords(street);
  let pointA = turf.point(coords[0]);
  let pointB = turf.point(coords[1]);

  return [pointA, pointB];

  // return 

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


/**
* Finds the two Point features that correspond to that street
* @param {Street being walked} street 
*/
function getIntersectionsForStreetByName(street) {


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








//Save street in walked database
function walkStreet(street) {
  //If streets is not walked, add it to db.
  //TODO replace this with API endpoint
  if (mStreetsWalked.features.indexOf(street) === -1)
    mStreetsWalked.features.push(street);
}




function closestLineToPoint(_point, _mapFeatures) {

  let closestLine;
  let shortestDistance = 999999;

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


function print(msg) {

  if (typeof msg === 'object') {
    console.log(toString(msg));
  } else {
    console.log(msg);
  }

}

function toString(Object) {
  return JSON.stringify(Object, null, null);
}

function distanceBetween(point1, point2) {
  let distance = turf.distance(point1, point2, { options: 'kilometers' }) * 1000;
  return distance;
}


//Get the center and round it to 6 decimal points
function getBufferCenter(buffer) {

  let center = turf.center(buffer);
  let lng = turf.getCoord(center)[0];
  let lat = turf.getCoord(center)[1];

  return turf.point([turf.round(lng, 6), turf.round(lat, 6)]);

}


function isSameCoords(p1, p2) {

  let p1_lng = p1[0];
  let p1_lat = p1[1];

  let p2_lng = p2[0];
  let p2_lat = p2[1];

  return (p1_lng === p2_lng && p1_lat === p2_lat) ? true : false;

}




function getTravelDirection(buffer, fromStreet) {
  let streetPoint = turf.along(fromStreet, 20 / 1000, { units: 'kilometers' });
  let bufferCenter = getBufferCenter(buffer);

  let bearing = turf.bearing(bufferCenter, streetPoint);
  // print('bearing');
  // print(bearing);

  let travelDirection;
  if (bearing <= 120 && bearing > 116) {
    travelDirection = orientation.WEST;
  }

  if (bearing >= -152 && bearing < -146) {
    travelDirection = orientation.NORTH;
  }

  if (bearing >= -62 && bearing < -58) {
    travelDirection = orientation.EAST;
  }

  if (bearing >= 26 && bearing < 30) {
    travelDirection = orientation.SOUTH;
  }


  print("Travel direction");
  print(travelDirection);
  return travelDirection;
}


function broadcastLocationMarkers(live, snapped) {
  let markers = {
    'real': turf.getCoords(live),
    'snapped': turf.getCoords(snapped)
  };
  io.emit(events.SEND_LOCATION_MARKERS, markers);
}

function broadcastStreetName(street) {
  let streetName = getFeatureName(street);
  io.emit(events.DISPLAY_STREET, streetName);
}


function broadcastLocationCoordinates(location) {
  let snappedLocationCoords = turf.getCoords(location);
  io.emit(events.DISPLAY_LOCATION, snappedLocationCoords);
}

function broadcastStreetCenter(point) {
  mActiveStreetCenter.geometry.coordinates = turf.getCoord(point);
  io.emit(events.SHOW_STREET_CENTER, mActiveStreetCenter);
}

//Update the layer data to show the saved streets
function broadcastWalkedStreets() {
  // console.log(`show walked streets ${toString(mStreetsWalked)}`);
  io.emit(events.DISPLAY_WALKED_STREETS, mStreetsWalked);
  // map.getSource('walkedStreets').setData(mStreetsWalked);
}

function broadcastIntersectionBuffers() {
  io.emit(events.DISPLAY_INTERSECTION_BUFFERS, mActiveIntersectionBuffers);
}

function broadcastContainingBuffer(containingBuffer) {
  io.emit(events.DISPLAY_ACTIVE_BUFFER, getFeatureName(containingBuffer));
}

function broadcastTravelCommand(command) {
  io.emit(events.SEND_DIRECTIONS, command);
}

