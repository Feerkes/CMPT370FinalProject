class Game {
  constructor(state) {
    this.state = state;
    this.spawnedObjects = [];
    this.collidableObjects = [];
    this.dir = 1;
    this.camMode = 1;

    //Store all player and AI trail segments for collision checks and arena resets
    this.trailObjects = [];

    //The distance an object moves before creating another trail segments
    this.trailSpacing = 0.05;

  }

  //Get the object's bounds using the same transformations as the renderer. This prevents the 
  //collision box from being offset when the object is rotated or scaled
  getBounds(object) {

    //Create an empty transformation matrix
    const modelMatrix = mat4.create();
   //Create a vector for the negative centre position
    const negativeCentroid = vec3.create();

    //Move the object, rotate it around its centre, and apply its scale.
    vec3.negate(negativeCentroid, object.centroid);
    mat4.translate(modelMatrix, modelMatrix, object.model.position);
    mat4.translate(modelMatrix, modelMatrix, object.centroid);
    mat4.mul(modelMatrix, modelMatrix, object.model.rotation);
    mat4.scale(modelMatrix, modelMatrix, object.model.scale);
    mat4.translate(modelMatrix, modelMatrix, negativeCentroid);

    //The four corners of the original cube
    const corners = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.5, 0, 0),
      vec3.fromValues(0, 0.5, 0),
      vec3.fromValues(0.5, 0.5, 0)
    ];

    //Transform every corner using the object's position, rotation, and size
    const transformedCorners = corners.map((corner) => {

      //Create a vector for the transformed corner and calculate the corner's position in the game
      const transformedCorner = vec3.create();
      vec3.transformMat4(transformedCorner, corner, modelMatrix);

      return transformedCorner;
    });


    //Collect the X & Y positions of every corner
    const xValues = transformedCorners.map((corner) => corner[0]);
    const yValues = transformedCorners.map((corner) => corner[1]);

    //Return the object's left, right, bottom, and top edges
    return {minX: Math.min(...xValues), maxX: Math.max(...xValues), minY: Math.min(...yValues), maxY: Math.max(...yValues)};
  }

  //Create a 0.10 by 0.10 collision box at the front of an object
  getHeadBounds(object) {
    const objectBounds = this.getBounds(object);
    const halfSize = 0.05;

    //Find the object's centre and forward direction
    const centerX = (objectBounds.minX + objectBounds.maxX) / 2;
    const centerY = (objectBounds.minY + objectBounds.maxY) / 2;
    const frontX = object.model.rotation[4];
    const frontY = object.model.rotation[5];

    //Find the distance from the object's centre to its front edge
    const frontDistance = Math.abs(frontX) > Math.abs(frontY)
      ? (objectBounds.maxX - objectBounds.minX) / 2
      : (objectBounds.maxY - objectBounds.minY) / 2;

    //Move the smaller collision box to the front of the object
    const headX = centerX + frontX * (frontDistance - halfSize);
    const headY = centerY + frontY * (frontDistance - halfSize);

    return {
      minX: headX - halfSize,
      maxX: headX + halfSize,
      minY: headY - halfSize,
      maxY: headY + halfSize
    };
  }

  //Check every wall by comparing its edges with the object's edges and
  //if they overlap both horizontally and vertically, a collision is found and another
  //helper function will return the player or ai to its last non-colliding position.
  isCollidingWithWall(object) {
    const objectBounds = this.getBounds(object);

    return this.walls.some((wall) => {
      
      //Get the wall's edges
      const wallBounds = this.getBounds(wall);

      //Return true if the object and wall overlap
      return this.boundsOverlap(objectBounds, wallBounds);
    });
  }

  //Return true if two objects overlap on both the X and Y axes
  boundsOverlap(firstBounds, secondBounds) {
    return firstBounds.minX < secondBounds.maxX &&
      firstBounds.maxX > secondBounds.minX &&
      firstBounds.minY < secondBounds.maxY &&
      firstBounds.maxY > secondBounds.minY;
  }


  //TRAIL SECTION --------------------------------------------------------

  //Create one small cube as part of an object's light trail
  createTrailSegment(owner, position, colour) {
    const trail = addCube({
      name: `Trail${this.trailObjects.length}`,
      type: "cube",
      material: {diffuse: colour, ambient: colour, specular: vec3.fromValues(0.1, 0.1, 0.1), n: 1, alpha: 1, shaderType: 0 }, //Change Later (Just did random numbers for testing collision)
      position: vec3.clone(position),
      scale: vec3.fromValues(0.16, 0.16, 0.2)
    }, this.state);

    //The owner ignores a new segment until it has completely moved away from it
    trail.trailOwner = owner;
    trail.ignoreOwner = true;
    this.trailObjects.push(trail);
  }

  //Add trail segments as an object moves through the arena
  updateTrail(object, lastTrailPosition, colour) {
    const direction = vec3.create();
    vec3.subtract(direction, object.model.position, lastTrailPosition);

    const distanceMoved = vec3.length(direction);

    if (distanceMoved > 0) {
      vec3.normalize(direction, direction);
    }

    //Fill every interval between the last trail point and the current position
    while (vec3.distance(object.model.position, lastTrailPosition) >= this.trailSpacing) {
      this.createTrailSegment(object, lastTrailPosition, colour);
      vec3.scaleAndAdd(
        lastTrailPosition,
        lastTrailPosition,
        direction,
        this.trailSpacing
      );
    }
  }

  //Check whether an object has hit its own trail or the other object's trail
  isCollidingWithTrail(object) {
    //Only the smaller front collider can crash into a trail
    const objectBounds = this.getHeadBounds(object);

    return this.trailObjects.some((trail) => {
      const trailBounds = this.getBounds(trail);
      const colliding = this.boundsOverlap(objectBounds, trailBounds);

      //Do not let a newly created segment collide with the object that created it to prevent the player or AI from immediately losing as soon as the game starts or when putting down their trail.
      if (trail.trailOwner === object && trail.ignoreOwner) {
        if (!colliding) {
          trail.ignoreOwner = false;
        }
        return false;
      }

      return colliding;
    });
  }

  //Helper function. Remove every trail and return both objects to their starting positions
  resetArena() {
    const trailsToRemove = new Set(this.trailObjects);
    this.state.objects = this.state.objects.filter((object) => !trailsToRemove.has(object));
    this.trailObjects = [];

    vec3.copy(this.player.model.position, this.playerStartPosition);
    mat4.copy(this.player.model.rotation, this.playerStartRotation);
    vec3.copy(this.enemy.model.position, this.enemyStartPosition);
    mat4.copy(this.enemy.model.rotation, this.enemyStartRotation);

    vec3.copy(this.playerTrailPosition, this.playerStartPosition);
    vec3.copy(this.enemyTrailPosition, this.enemyStartPosition);
    this.dir = 1;
  }

  // Change the movement direction and make the player face that direction.
  setPlayerDirection(direction, angle) {
    //Ignore a direct 180-degree turn (QOL Change)
    const oppositeDirection =
      (this.dir === 1 && direction === 3) ||
      (this.dir === 3 && direction === 1) ||
      (this.dir === 2 && direction === 4) ||
      (this.dir === 4 && direction === 2);

    if (oppositeDirection) {
      return;
    }

    //Place a segment at the corner so the old and new trail directions connect
    if (direction !== this.dir) {
      this.createTrailSegment(this.player, this.player.model.position, this.playerTrailColour);
      vec3.copy(this.playerTrailPosition, this.player.model.position);
    }

    this.dir = direction;
    mat4.identity(this.player.model.rotation);
    this.player.rotate('z', angle);
  }



  // example - we can add our own custom method to our game and call it using 'this.customMethod()'
  // customMethod() {
  //   console.log("Custom method!");
  // }

  // example - create a collider on our object with various fields we might need (you will likely need to add/remove/edit how this works)
  // createSphereCollider(object, radius, onCollide = null) {
  //   object.collider = {
  //     type: "SPHERE",
  //     radius: radius,
  //     onCollide: onCollide ? onCollide : (otherObject) => {
  //       console.log(`Collided with ${otherObject.name}`);
  //     }
  //   };
  //   this.collidableObjects.push(object);
  // }

  // example - function to check if an object is colliding with collidable objects
  // checkCollision(object) {
  //   // loop over all the other collidable objects 
  //   this.collidableObjects.forEach(otherObject => {
  //     // probably don't need to collide with ourselves
  //     if (object.name === otherObject.name) {
  //       return;
  //     }
  //     // do a check to see if we have collided, if we have we can call object.onCollide(otherObject) which will
  //     // call the onCollide we define for that specific object. This way we can handle collisions identically for all
  //     // objects that can collide but they can do different things (ie. player colliding vs projectile colliding)
  //     // use the modeling transformation for object and otherObject to transform position into current location
  //     // ie: 
  //     // if (collide){ object.collider.onCollide(otherObject) } // fires what we defined our object should do when it collides
  //   });
  // }

  // runs once on startup after the scene loads the objects
  async onStart() {
    this.player = getObject(this.state, "Player"); //You
    this.enemy = getObject(this.state, "Enemy");  //Your Worst Enemy

    //THE WALLS you are contained in (Arena)
    this.walls = [
      getObject(this.state, "Wall"),
      getObject(this.state, "Wall2"),
      getObject(this.state, "Wall3"),
      getObject(this.state, "Wall4")
    ];

    //Save the starting positions and rotations so the arena can be reset
    this.playerStartPosition = vec3.clone(this.player.model.position);
    this.playerStartRotation = mat4.clone(this.player.model.rotation);
    this.enemyStartPosition = vec3.clone(this.enemy.model.position);
    this.enemyStartRotation = mat4.clone(this.enemy.model.rotation);

    //Store where the next player and enemy trail segments should begin
    this.playerTrailPosition = vec3.clone(this.player.model.position);
    this.enemyTrailPosition = vec3.clone(this.enemy.model.position);

    //Use green for the player's trail and red for the enemy's trail
    this.playerTrailColour = vec3.fromValues(0.2, 1.0, 0.0);
    this.enemyTrailColour = vec3.fromValues(1.0, 0.0, 0.0);

  
    // console.log("On start");

    // // this just prevents the context menu from popping up when you right click
    // document.addEventListener("contextmenu", (e) => {
    //   e.preventDefault();
    // }, false);

    // // example - set an object in onStart before starting our render loop!
    // this.cube = getObject(this.state, "cube1");
    // const otherCube = getObject(this.state, "cube2"); // we wont save this as instance var since we dont plan on using it in update

    // // example - create sphere colliders on our two objects as an example, we give 2 objects colliders otherwise
    // // no collision can happen
    // this.createSphereCollider(this.cube, 0.5, (otherObject) => {
    //   console.log(`This is a custom collision of ${otherObject.name}`)
    // });
    // // this.createSphereCollider(otherCube, 0.5);

    // // example - setting up a key press event to move an object in the scene

    //WASD Movement (classic)
    document.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();

      switch (key) {
        case "w":
          e.preventDefault();
          this.setPlayerDirection(1, 0);
          break;
        case "a":
          e.preventDefault();
          this.setPlayerDirection(2, 1.5708);
          break;
        case "s":
          e.preventDefault();
          this.setPlayerDirection(3, 3.1416);
          break;
        case "d":
          e.preventDefault();
          this.setPlayerDirection(4, -1.5708);
          break;
      }

      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        this.camMode *= -1;
      }
    });

    // calling our custom method! (we could put spawning logic, collision logic etc in there ;)
    // this.customMethod();

    // example: spawn some stuff before the scene starts
    // for (let i = 0; i < 10; i++) {
    //     for (let j = 0; j < 10; j++) {
    //         for (let k = 0; k < 10; k++) {
    //             spawnObject({
    //                 name: `new-Object${i}${j}${k}`,
    //                 type: "cube",
    //                 material: {
    //                     diffuse: randomVec3(0, 1)
    //                 },
    //                 position: vec3.fromValues(4 - i, 5 - j, 10 - k),
    //                 scale: vec3.fromValues(0.5, 0.5, 0.5)
    //             }, this.state);
    //         }
    //     }
    // }

    // example: spawn in objects, set constantRotate to true for them (used below) and give them a collider
    //   for (let i = 0; i < 2; i++) {
    //     let tempObject = await spawnObject({
    //       name: `new-Object${i}`,
    //       type: "cube",
    //       material: {
    //         diffuse: randomVec3(0, 1)
    //       },
    //       position: vec3.fromValues(4 - i, 0, 0),
    //       scale: vec3.fromValues(0.5, 0.5, 0.5)
    //     }, this.state);


    //     tempObject.constantRotate = true;         // lets add a flag so we can access it later
    //     this.spawnedObjects.push(tempObject);     // add these to a spawned objects list
    //     this.collidableObjects.push(tempObject);  // say these can be collided into
    //   }
  }

  // Runs once every frame non stop after the scene loads
onUpdate(deltaTime) {
  let player = getObject(this.state, "Player");

  //Move the player continuously in the selected direction
  switch (this.dir) {
    case 1:
      player.translate(vec3.fromValues(0.0, 1.0 * deltaTime, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] + 0.25,player.model.position[1] - 0.2,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(0, 1, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    case 2:
      player.translate(vec3.fromValues(-1.0 * deltaTime, 0.0, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] + 0.7, player.model.position[1] + 0.25,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(-1, 0, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    case 3:
      player.translate(vec3.fromValues(0.0, -1.0 * deltaTime, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] + 0.25,player.model.position[1] + 0.7,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(0, -1, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    case 4:
      player.translate(vec3.fromValues(1.0 * deltaTime, 0.0, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] - 0.2,player.model.position[1] + 0.25,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(1, 0, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    default:
      break;
  }

  //Create trails for both objects when the player or AI moves.
  this.updateTrail(player, this.playerTrailPosition, this.playerTrailColour);
  this.updateTrail(this.enemy, this.enemyTrailPosition, this.enemyTrailColour);

  //Reset the arena if either object hits a wall or any trail segment
  if (this.isCollidingWithWall(player) || this.isCollidingWithWall(this.enemy) || this.isCollidingWithTrail(player) ||  this.isCollidingWithTrail(this.enemy)) {
    this.resetArena();
    return;
  }

  //Use the top-down camera
  if (this.camMode == 1) {
    this.state.camera.position = vec3.fromValues(0, 0, 6);
    this.state.camera.front = vec3.fromValues(0, 0, -1);
    this.state.camera.up = vec3.fromValues(0, 1, 0);
  }

    // example: Rotate a single object we defined in our start method
    // this.cube.rotate('x', deltaTime * 0.5);

    // example: Rotate all objects in the scene marked with a flag
    // this.state.objects.forEach((object) => {
    //   if (object.constantRotate) {
    //     object.rotate('y', deltaTime * 0.5);
    //   }
    // });

    // simulate a collision between the first spawned object and 'cube' 
    // if (this.spawnedObjects[0].collidable) {
    //     this.spawnedObjects[0].onCollide(this.cube);
    // }

    // example: Rotate all the 'spawned' objects in the scene
    // this.spawnedObjects.forEach((object) => {
    //     object.rotate('y', deltaTime * 0.5);
    // });


    // example - call our collision check method on our cube
    // this.checkCollision(this.cube);
  }
}
