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
  print(`Final options ${travelDirections}`);
  print(`Final Command ${travelCommand}\n`);

  broadcastTravelCommand(travelCommand);


  return;

}


// function isSameStreet(street1, street2) {

//   let s1 = {
//     p1: turf.getCoords(street1)[0],
//     p2: turf.getCoords(street1)[1]
//   }

//   let s2 = {
//     p1: turf.getCoords(street2)[0],
//     p2: turf.getCoords(street2)[1]
//   }

//   if (isSameCoords(s1.p1, s2.p1)) {
//     if (isSameCoords(s1.p2, s2.p2)) {
//       return true;
//     }
//   }

//   if (isSameCoords(s1.p1, s2.p2)) {
//     if (isSameCoords(s1.p2, s2.p1)) {
//       return true;
//     }
//   }
//   return false;
// }



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



  let travelDirection = getTravelDirection(buffer, virtualFromStreet);
  let bearingDirections = getDirectionsForBearings(travelDirection, bearings);


  return bearingDirections;
}


function streetIsWalked(buffer, street) {

  let invertedStreet = getInvertedStreet(street);
  let filteredByStreet = mStreetsWalked.features.filter(s => turf.getCoords(s)[0] === turf.getCoords(street)[0] || turf.getCoords(s)[1] === turf.getCoords(street)[1]);
  let filteredByInvertedStreet = mStreetsWalked.features.filter(s => turf.getCoords(s)[0] === turf.getCoords(invertedStreet)[0] || turf.getCoords(s)[1] === turf.getCoords(invertedStreet)[1]);

  return (filteredByStreet.length !== 0 || filteredByInvertedStreet.length !== 0);

}


function getInvertedStreet(street) {

  let coords = turf.getCoords(street);
  let p1 = coords[0];
  let p2 = coords[1];

  return turf.lineString([p2, p1]);

}

function getDirectionsForBearings(travelDirections, bearings) {


  let directions = [];

  bearings.forEach(bearing => {

    switch (travelDirections) {

      case orientation.NORTH:

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


  //find the Points from the collection that match the street that is being walked
  let streetIntersections = getStreetCornerPoints(street);

  let pointA = streetIntersections[0];
  let pointB = streetIntersections[1];

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

  turf.featureEach(_mapFeatures, (currentLine, lineIndex) => {
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

