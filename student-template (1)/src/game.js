class Game {
  constructor(state) {
    this.state = state;
    this.spawnedObjects = [];
    this.collidableObjects = [];
    this.dir = 1;
    this.camMode = 1;
    this.playerScore = 0;
    this.enemyScore = 0;

    //Store simple collision boxes for the player and enemy trails
    this.trailSegments = [];

    //The size and spacing of the connected trail mesh
    this.trailSpacing = 0.05;
    this.trailHalfWidth = 0.04;
    this.trailHalfHeight = 0.05;

    //Both objects use the same speed, which increases as the round continues
    this.startSpeed = 1.0;
    this.currentSpeed = this.startSpeed;
    this.speedIncreasePerSecond = 0.03;
    this.maxSpeed = 5.0;

    //Basic enemy movement and obstacle avoidance
    this.enemyDir = 1;
    this.enemyLookAhead = 0.45;

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

  //Return the centre of an object in world coordinates
  getObjectCenter(object) {
    const center = vec3.create();
    vec3.add(center, object.model.position, object.centroid);
    return center;
  }

  //Return the direction that an object is facing
  getObjectDirection(object) {
    const direction = vec3.fromValues(object.model.rotation[4], object.model.rotation[5], 0);
    vec3.normalize(direction, direction);
    return direction;
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

  //Clear one of the existing light-trail objects and begin a new connected mesh
  resetTrailMesh(trail, startPosition, startDirection) {
    trail.model.position = vec3.create();
    trail.model.scale = vec3.fromValues(1, 1, 1);
    trail.model.rotation = mat4.create();
    trail.model.vertices = [];
    trail.model.normals = [];
    trail.model.uvs = [];
    trail.model.bitangents = [];
    trail.model.triangles = [];
    trail.ringCount = 0;
    trail.lastCenter = null;
    trail.lastDirection = null;

    this.addTrailRing(trail, startPosition, startDirection);
    this.updateTrailBuffers(trail);
  }

  //Add four vertices and connect them to the previous four vertices
  addTrailRing(trail, center, direction) {
    const forward = vec3.fromValues(direction[0], direction[1], 0);

    if (vec3.length(forward) === 0) {
      return false;
    }

    vec3.normalize(forward, forward);

    //Do not add the same four vertices twice
    if (trail.lastCenter && vec3.distance(trail.lastCenter, center) < 0.000001 &&
      vec3.dot(trail.lastDirection, forward) > 0.9999) {
      return false;
    }

    const right = vec3.fromValues(forward[1], -forward[0], 0);
    const leftX = center[0] - right[0] * this.trailHalfWidth;
    const leftY = center[1] - right[1] * this.trailHalfWidth;
    const rightX = center[0] + right[0] * this.trailHalfWidth;
    const rightY = center[1] + right[1] * this.trailHalfWidth;
    const bottomZ = center[2] - this.trailHalfHeight;
    const topZ = center[2] + this.trailHalfHeight;
    const firstVertex = trail.ringCount * 4;

    trail.model.vertices.push(
      leftX, leftY, bottomZ,
      rightX, rightY, bottomZ,
      rightX, rightY, topZ,
      leftX, leftY, topZ
    );

    //The trail uses its material colour, so these simple values are enough
    for (let i = 0; i < 4; i++) {
      trail.model.normals.push(0, 0, 1);
      trail.model.bitangents.push(1, 0, 0);
    }
    trail.model.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);

    if (trail.ringCount > 0) {
      const previous = firstVertex - 4;

      //Connect the previous four points to the new four points
      trail.model.triangles.push(
        previous, previous + 1, firstVertex + 1,
        previous, firstVertex + 1, firstVertex,

        previous + 1, previous + 2, firstVertex + 2,
        previous + 1, firstVertex + 2, firstVertex + 1,

        previous + 2, previous + 3, firstVertex + 3,
        previous + 2, firstVertex + 3, firstVertex + 2,

        previous + 3, previous, firstVertex,
        previous + 3, firstVertex, firstVertex + 3,

        firstVertex, firstVertex + 1, firstVertex + 2,
        firstVertex, firstVertex + 2, firstVertex + 3
      );
    }

    trail.ringCount += 1;
    trail.lastCenter = vec3.clone(center);
    trail.lastDirection = vec3.clone(forward);
    return true;
  }

  //Upload the changed arrays to the existing trail object's buffers
  updateTrailBuffers(trail) {
    const gl = this.state.gl;
    gl.bindVertexArray(trail.buffers.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, trail.buffers.attributes.position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(trail.model.vertices), gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, trail.buffers.attributes.normal);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(trail.model.normals), gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, trail.buffers.attributes.uv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(trail.model.uvs), gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, trail.buffers.attributes.bitangent);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(trail.model.bitangents), gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, trail.buffers.indicies);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(trail.model.triangles), gl.DYNAMIC_DRAW);
    trail.buffers.numVertices = trail.model.triangles.length;
  }

  //Add four vertices and one simple collision box at the next trail point
  addTrailPoint(trail, owner, position, direction) {
    const previousCenter = trail.lastCenter ? vec3.clone(trail.lastCenter) : null;

    if (!this.addTrailRing(trail, position, direction)) {
      return false;
    }

    if (previousCenter && vec3.distance(previousCenter, position) > 0.000001) {
      this.trailSegments.push({
        owner: owner,
        ignoreOwner: true,
        minX: Math.min(previousCenter[0], position[0]) - this.trailHalfWidth,
        maxX: Math.max(previousCenter[0], position[0]) + this.trailHalfWidth,
        minY: Math.min(previousCenter[1], position[1]) - this.trailHalfWidth,
        maxY: Math.max(previousCenter[1], position[1]) + this.trailHalfWidth
      });
    }

    return true;
  }

  //Extend one connected trail mesh as an object moves through the arena
  updateTrail(object, trail, lastTrailPosition) {
    const currentPosition = this.getObjectCenter(object);
    const direction = vec3.create();
    vec3.subtract(direction, currentPosition, lastTrailPosition);

    const distanceMoved = vec3.length(direction);

    if (distanceMoved <= 0) {
      return;
    }

    vec3.normalize(direction, direction);
    let changed = false;

    //Add another four points at a turn so there is no gap in the corner
    if (trail.lastDirection && vec3.dot(trail.lastDirection, direction) < 0.9999) {
      changed = this.addTrailPoint(trail, object, lastTrailPosition, direction) || changed;
    }

    //Fill every interval between the last trail point and the current position
    while (vec3.distance(currentPosition, lastTrailPosition) >= this.trailSpacing) {
      const nextPosition = vec3.create();
      vec3.scaleAndAdd(nextPosition, lastTrailPosition, direction, this.trailSpacing);
      changed = this.addTrailPoint(trail, object, nextPosition, direction) || changed;
      vec3.copy(lastTrailPosition, nextPosition);
    }

    if (changed) {
      this.updateTrailBuffers(trail);
    }
  }

  //Finish the old straight section at the exact corner before turning
  finishTrailAtTurn(object, trail, lastTrailPosition) {
    const currentPosition = this.getObjectCenter(object);

    if (vec3.distance(currentPosition, lastTrailPosition) > 0.000001) {
      if (this.addTrailPoint(trail, object, currentPosition, this.getObjectDirection(object))) {
        this.updateTrailBuffers(trail);
      }
      vec3.copy(lastTrailPosition, currentPosition);
    }
  }

  //Check whether an object has hit its own trail or the other object's trail
  isCollidingWithTrail(object) {
    //Only the smaller front collider can crash into a trail
    const objectBounds = this.getHeadBounds(object);

    return this.trailSegments.some((segment) => {
      const colliding = this.boundsOverlap(objectBounds, segment);

      //Do not let a newly created segment collide with the object that created it to prevent the player or AI from immediately losing as soon as the game starts or when putting down their trail.
      if (segment.owner === object && segment.ignoreOwner) {
        if (!colliding) {
          segment.ignoreOwner = false;
        }
        return false;
      }

      return colliding;
    });
  }

  //Display the current player and AI scores
  updateScoreCounter() {
    document.getElementById("playerScore").textContent = this.playerScore;
    document.getElementById("enemyScore").textContent = this.enemyScore;
  }

  //Helper function. Remove every trail and return both objects to their starting positions
  resetArena() {
    vec3.copy(this.player.model.position, this.playerStartPosition);
    mat4.copy(this.player.model.rotation, this.playerStartRotation);
    vec3.copy(this.enemy.model.position, this.enemyStartPosition);
    mat4.copy(this.enemy.model.rotation, this.enemyStartRotation);

    const playerCenter = this.getObjectCenter(this.player);
    const enemyCenter = this.getObjectCenter(this.enemy);
    vec3.copy(this.playerTrailPosition, playerCenter);
    vec3.copy(this.enemyTrailPosition, enemyCenter);

    this.trailSegments = [];
    this.resetTrailMesh(this.playerTrail, playerCenter, this.getObjectDirection(this.player));
    this.resetTrailMesh(this.enemyTrail, enemyCenter, this.getObjectDirection(this.enemy));
    this.dir = 1;
    this.enemyDir = 1;
    this.currentSpeed = this.startSpeed;
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

    //Finish the old trail section before turning
    if (direction !== this.dir) {
      this.finishTrailAtTurn(this.player, this.playerTrail, this.playerTrailPosition);
    }

    this.dir = direction;
    mat4.identity(this.player.model.rotation);
    this.player.rotate('z', angle);
  }

  //ENEMY AI SECTION -----------------------------------------------------

  //Return the movement vector and rotation for one of the four directions
  getDirectionData(direction) {
    switch (direction) {
      case 1:
        return {movement: vec3.fromValues(0, 1, 0), angle: 0};
      case 2:
        return {movement: vec3.fromValues(-1, 0, 0), angle: 1.5708};
      case 3:
        return {movement: vec3.fromValues(0, -1, 0), angle: 3.1416};
      case 4:
        return {movement: vec3.fromValues(1, 0, 0), angle: -1.5708};
    }
  }

  //Check a small square ahead of the enemy for a wall or trail
  isEnemyDirectionBlocked(direction) {
    const directionData = this.getDirectionData(direction);
    const enemyCenter = this.getObjectCenter(this.enemy);
    const checkX = enemyCenter[0] + directionData.movement[0] * this.enemyLookAhead;
    const checkY = enemyCenter[1] + directionData.movement[1] * this.enemyLookAhead;
    const halfSize = 0.05;
    const checkBounds = {
      minX: checkX - halfSize,
      maxX: checkX + halfSize,
      minY: checkY - halfSize,
      maxY: checkY + halfSize
    };

    const wallBlocked = this.walls.some((wall) =>
      this.boundsOverlap(checkBounds, this.getBounds(wall))
    );

    const trailBlocked = this.trailSegments.some((segment) => {
      //Ignore the newest part of the enemy's own trail while it is still nearby
      if (segment.owner === this.enemy && segment.ignoreOwner) {
        return false;
      }
      return this.boundsOverlap(checkBounds, segment);
    });

    return wallBlocked || trailBlocked;
  }

  //Turn the enemy and finish its old trail section at the corner
  setEnemyDirection(direction) {
    if (direction === this.enemyDir) {
      return;
    }

    this.finishTrailAtTurn(this.enemy, this.enemyTrail, this.enemyTrailPosition);
    this.enemyDir = direction;

    const directionData = this.getDirectionData(direction);
    mat4.identity(this.enemy.model.rotation);
    this.enemy.rotate('z', directionData.angle);
  }

  //Move forward and make a safe random 90-degree turn when something is ahead
  updateEnemy(deltaTime) {
    if (this.isEnemyDirectionBlocked(this.enemyDir)) {
      const leftDirection = this.enemyDir === 4 ? 1 : this.enemyDir + 1;
      const rightDirection = this.enemyDir === 1 ? 4 : this.enemyDir - 1;
      const safeDirections = [];

      if (!this.isEnemyDirectionBlocked(leftDirection)) {
        safeDirections.push(leftDirection);
      }
      if (!this.isEnemyDirectionBlocked(rightDirection)) {
        safeDirections.push(rightDirection);
      }

      if (safeDirections.length > 0) {
        const choice = Math.floor(Math.random() * safeDirections.length);
        this.setEnemyDirection(safeDirections[choice]);
      }
    }

    const directionData = this.getDirectionData(this.enemyDir);
    const movement = vec3.create();
    vec3.scale(movement, directionData.movement, this.currentSpeed * deltaTime);
    this.enemy.translate(movement);
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

    //Use green for the player's trail and red for the enemy's trail
    this.playerTrailColour = vec3.fromValues(0.2, 1.0, 0.0);
    this.enemyTrailColour = vec3.fromValues(1.0, 0.0, 0.0);

    //Reuse the two trail objects that are already in the scene file
    this.playerTrail = getObject(this.state, "light trail player");
    this.enemyTrail = getObject(this.state, "light trail enemy");
    //Keep trail intersections in a stable depth order without changing their shapes
    this.playerTrail.forceDepthWrite = true;
    this.enemyTrail.depthBias = 2;
    this.playerTrail.material.diffuse = this.playerTrailColour;
    this.playerTrail.material.ambient = this.playerTrailColour;
    this.enemyTrail.material.diffuse = this.enemyTrailColour;
    this.enemyTrail.material.ambient = this.enemyTrailColour;

    const playerCenter = this.getObjectCenter(this.player);
    const enemyCenter = this.getObjectCenter(this.enemy);
    this.playerTrailPosition = vec3.clone(playerCenter);
    this.enemyTrailPosition = vec3.clone(enemyCenter);

    this.resetTrailMesh(this.playerTrail, playerCenter, this.getObjectDirection(this.player));
    this.resetTrailMesh(this.enemyTrail, enemyCenter, this.getObjectDirection(this.enemy));
    this.updateScoreCounter();

  
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
      if (this.camMode == 1) {
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
      } else if (this.camMode == -1) {
        let newdir = this.dir
        switch (key) {
          case "a":
            e.preventDefault(); 
            newdir+=1; 
            if (newdir>4) {newdir = 1;}
            switch (newdir){
              case 1:
                this.setPlayerDirection(newdir, 0); 
                break; 
              case 2:
                this.setPlayerDirection(newdir, 1.5708); 
                break; 
              case 3:
                this.setPlayerDirection(newdir, 3.1416); 
                break; 
              case 4: 
                this.setPlayerDirection(newdir, -1.5708); 
                break; 
            }
            break; 
          
          case "d":
            e.preventDefault(); 
            newdir -= 1; 
            if (newdir<1) {newdir = 4;}
            switch (newdir){
              case 1:
                this.setPlayerDirection(newdir, 0); 
                break; 
              case 2:
                this.setPlayerDirection(newdir, 1.5708); 
                break; 
              case 3:
                this.setPlayerDirection(newdir, 3.1416); 
                break; 
              case 4: 
                this.setPlayerDirection(newdir, -1.5708); 
                break; 
            }
            break;
        }
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

  //Gradually speed up both the player and enemy, up to the maximum speed
  this.currentSpeed = Math.min(
    this.maxSpeed,
    this.currentSpeed + this.speedIncreasePerSecond * deltaTime
  );

  //Move the player continuously in the selected direction
  switch (this.dir) {
    case 1:
      player.translate(vec3.fromValues(0.0, this.currentSpeed * deltaTime, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] + 0.25,player.model.position[1] - 0.2,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(0, 1, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    case 2:
      player.translate(vec3.fromValues(-this.currentSpeed * deltaTime, 0.0, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] + 0.7, player.model.position[1] + 0.25,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(-1, 0, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    case 3:
      player.translate(vec3.fromValues(0.0, -this.currentSpeed * deltaTime, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] + 0.25,player.model.position[1] + 0.7,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(0, -1, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    case 4:
      player.translate(vec3.fromValues(this.currentSpeed * deltaTime, 0.0, 0.0));

      if (this.camMode == -1) {
        this.state.camera.position = vec3.fromValues(player.model.position[0] - 0.2,player.model.position[1] + 0.25,player.model.position[2] + 0.5);
        this.state.camera.front = vec3.fromValues(1, 0, 0);
        this.state.camera.up = vec3.fromValues(0, 0, 1);
      }
      break;

    default:
      break;
  }

  //Move the enemy and turn before it reaches a wall or trail
  this.updateEnemy(deltaTime);

  //Extend the player and enemy's single trail meshes as they move
  this.updateTrail(player, this.playerTrail, this.playerTrailPosition);
  this.updateTrail(this.enemy, this.enemyTrail, this.enemyTrailPosition);

  //Award one point to the survivor, then reset the arena
  const playerCrashed = this.isCollidingWithWall(player) || this.isCollidingWithTrail(player);
  const enemyCrashed = this.isCollidingWithWall(this.enemy) || this.isCollidingWithTrail(this.enemy);

  if (playerCrashed || enemyCrashed) {
    if (playerCrashed && !enemyCrashed) {
      this.enemyScore += 1;
    } else if (enemyCrashed && !playerCrashed) {
      this.playerScore += 1;
    }

    this.updateScoreCounter();
    this.resetArena();
    return;
  }

  //Use the top-down camera
  if (this.camMode == 1) {
    this.state.camera.position = vec3.fromValues(0, 0, 6);
    this.state.camera.front = vec3.fromValues(0, 0, -1);
    this.state.camera.up = vec3.fromValues(0, 1, 0);
  }


  //have the point light follow the player
  //this.playerLight = getObject(this.state, "playerLight");
  //this.state. = vec3.fromValues(this.player.model.position.x, this.player.model.position.y, 4.0); 

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
