var state = {};
var game;
var sceneFile = "scene.json"; // can change this to be the name of your scene

// This function loads on window load, uses async functions to load the scene then try to render it
window.onload = async () => {
  try {
    console.log("Starting to load scene file");
    await parseSceneFile(`./statefiles/${sceneFile}`, state);
    main();
  } catch (err) {
    console.error(err);
    alert(err);
  }
}

/**
 * 
 * @param {object - contains vertex, normal, uv information for the mesh to be made} mesh 
 * @param {object - the game object that will use the mesh information} object 
 * @purpose - Helper function called as a callback function when the mesh is done loading for the object
 */
async function createMesh(mesh, object, vertShader, fragShader) {
  let testModel = new Model(state.gl, object, mesh);
  testModel.vertShader = vertShader ? vertShader : state.vertShaderSample;
  testModel.fragShader = fragShader ? fragShader : state.fragShaderSample;
  await testModel.setup();
  addObjectToScene(state, testModel);
  return testModel;
}

/**
 * Main function that gets called when the DOM loads
 */
async function main() {
  //document.body.appendChild( stats.dom );
  const canvas = document.querySelector("#glCanvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Initialize the WebGL2 context
  var gl = canvas.getContext("webgl2");

  // Only continue if WebGL2 is available and working
  if (gl === null) {
    printError('WebGL 2 not supported by your browser',
      'Check to see you are using a <a href="https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API#WebGL_2_2" class="alert-link">modern browser</a>.');
    return;
  }

  /**
   * Sample vertex and fragment shader here that simply applies MVP matrix 
   * and diffuse colour of each object
   */
  const vertShaderSample =
    `#version 300 es
        in vec3 aPosition;
        in vec3 aNormal;
        in vec3 aBitangent;
        in vec2 aUV;

        uniform mat4 uProjectionMatrix;
        uniform mat4 uViewMatrix;
        uniform mat4 uModelMatrix;
        uniform mat4 uNormalMatrix;

        out vec3 oNormal;
        out vec2 oUV;
        out vec3 oFragPosition;
        out vec3 oBitangent;

        void main() {
            //Transform normal using the inverse-transpose model matrix
            oNormal = vec3(uNormalMatrix * vec4(aNormal, 0.0));
            
            //Pass UV to fragment shader
            oUV = aUV;
            
            //Checks the fragment position in world space
            oFragPosition = vec3(uModelMatrix * vec4(aPosition, 1.0));

            //Calculates the final vertex position
            gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
            
            //Transform the model's bitangent into world space
            oBitangent = normalize(vec3(uModelMatrix * vec4(aBitangent, 0.0)));
        }
        `;

  const fragShaderSample =
    `#version 300 es
      #define MAX_LIGHTS 20
      precision highp float;

      struct PointLight {
          vec3 position;
          vec3 colour;
          float strength;

      };

      uniform PointLight pointLights[MAX_LIGHTS];
      uniform int numLights;

      uniform vec3 diffuseVal;
      uniform vec3 ambientVal;
      uniform vec3 specularVal;
      uniform float nVal;
      uniform float alphaVal;
      uniform vec3 uCameraPosition;

      in vec3 oNormal;
      in vec3 oFragPosition;
      in vec2 oUV;
      in vec3 oBitangent;

      uniform sampler2D uTexture;
      uniform int samplerExists;
      uniform sampler2D uNormalTexture;
      uniform int normalSamplerExists;

      out vec4 fragColor;

      //Calculate one light's Blinn-Phong contribution
      vec3 calculateColor(PointLight light, vec3 N) {

          //Directions toward the light and camera
          vec3 L = normalize(light.position - oFragPosition);
          vec3 V = normalize(uCameraPosition - oFragPosition);

          //Halfway vector used for Blinn-Phong specular lighting
          vec3 H = normalize(L + V);

          if (normalSamplerExists == 1) {
              vec3 normVector = texture(uNormalTexture, oUV).xyz;
              normVector = 2.0 * normVector - 1.0;

              vec3 B = normalize(oBitangent);
              vec3 T = normalize(cross(B, N));

              mat3 nMatrix = mat3(T, B, N);
              N = normalize(nMatrix * normVector);
          }

          //Ambient lighting
          vec3 ambient =
              ambientVal *
              light.colour *
              light.strength;

          //Diffuse lighting
          float normalDotLight = max(dot(N, L), 0.0);

          //Use either the material colour or a mixture of material and texture
          vec3 Kd = diffuseVal;

          if (samplerExists == 1) {
              vec3 textureColor = texture(uTexture, oUV).rgb;
              Kd = mix(diffuseVal, textureColor, 0.7);
          }

          //Apply lighting to the selected diffuse colour
          vec3 diffuse =
              Kd * light.colour * light.strength * normalDotLight;

          //Specular lighting
          vec3 specular = vec3(0.0);

          if (normalDotLight > 0.0) {
              float normalDotHalfway = max(dot(N, H), 0.0);
              specular = specularVal * light.colour * light.strength * pow(normalDotHalfway, nVal);
          }

          return ambient + diffuse + specular;
      }

      void main() {
          //do texture work if sampler exists
          
          //Interpolated normals must be normalized
          vec3 N = normalize(oNormal);
          vec3 totalColour = vec3(0.0);

          //Add the contribution from every active light
          for (int i = 0; i < numLights; i++) {
              totalColour += calculateColor(pointLights[i], N);
          }
          
          fragColor = vec4(totalColour, alphaVal);
          
      }
      `;

  /**
   * Initialize state with new values (some of these you can replace/change)
   */
  state = {
    ...state, // this just takes what was already in state and applies it here again
    gl,
    vertShaderSample,
    fragShaderSample,
    canvas: canvas,
    objectCount: 0,
    lightIndices: [],
    keyboard: {},
    mouse: { sensitivity: 0.2 },
    meshCache: {},
    samplerExists: 0,
    samplerNormExists: 0,
  };

  state.numLights = state.pointLights.length;

  const now = new Date();
  for (let i = 0; i < state.loadObjects.length; i++) {
    const object = state.loadObjects[i];

    if (object.type === "mesh") {
      await addMesh(object);
    } else if (object.type === "cube") {
      addCube(object, state);
    } else if (object.type === "plane") {
      addPlane(object, state);
    } else if (object.type.includes("Custom")) {
      addCustom(object, state);
    }
    console.log(`loaded ${object.name};`);
  }

  const then = new Date();
  const loadingTime = (then.getTime() - now.getTime()) / 1000;
  console.log(`Scene file loaded in ${loadingTime} seconds.`);

  game = new Game(state);
  await game.onStart();
  loadingPage.remove();
  startRendering(gl, state); // now that scene is setup, start rendering it
}

/**
 * 
 * @param {object - object containing scene values} state 
 * @param {object - the object to be added to the scene} object 
 * @purpose - Helper function for adding a new object to the scene and refreshing the GUI
 */
function addObjectToScene(state, object) {
  object.name = object.name;
  state.objects.push(object);
}

/**
 * 
 * @param {gl context} gl 
 * @param {object - object containing scene values} state 
 * @purpose - Calls the drawscene per frame
 */
function startRendering(gl, state) {
  // A variable for keeping track of time between frames
  var then = 0.0;

  // This function is called when we want to render a frame to the canvas
  function render(now) {
    now *= 0.001; // convert to seconds
    const deltaTime = now - then;
    then = now;

    state.deltaTime = deltaTime;
    drawScene(gl, deltaTime, state);
    game.onUpdate(deltaTime); //constantly call our game loop

    // Request another frame when this one is done
    requestAnimationFrame(render);
  }
  // Draw the scene
  requestAnimationFrame(render);
}

/**
 * 
 * @param {gl context} gl 
 * @param {float - time from now-last} deltaTime 
 * @param {object - contains the state for the scene} state 
 * @purpose Iterate through game objects and render the objects aswell as update uniforms
 */
function drawScene(gl, deltaTime, state) {
  gl.clearColor(state.settings.backgroundColor[0], state.settings.backgroundColor[1], state.settings.backgroundColor[2], 1.0); // Here we are drawing the background color that is saved in our state
  gl.enable(gl.DEPTH_TEST); // Enable depth testing
  gl.depthFunc(gl.LEQUAL); // Near things obscure far things
  gl.disable(gl.CULL_FACE); // Cull the backface of our objects to be more efficient
  gl.cullFace(gl.BACK);
  // gl.frontFace(gl.CCW);
  gl.clearDepth(1.0); // Clear everything

  gl.depthMask(true);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  //Implemented stuff place below here ------------------------------------

  //Enable standard alpha blending
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  //Above here ------------------------------------------------------------

  // sort objects by nearness to camera
  let sorted = [...state.objects].sort((a, b) => {
    let aCentroidFour = vec4.fromValues(a.centroid[0], a.centroid[1], a.centroid[2], 1.0);
    vec4.transformMat4(aCentroidFour, aCentroidFour, a.modelMatrix);

    let bCentroidFour = vec4.fromValues(b.centroid[0], b.centroid[1], b.centroid[2], 1.0);
    vec4.transformMat4(bCentroidFour, bCentroidFour, b.modelMatrix);

    const aDistance = vec3.distance(state.camera.position, vec3.fromValues(aCentroidFour[0], aCentroidFour[1], aCentroidFour[2]));
    const bDistance = vec3.distance(state.camera.position, vec3.fromValues(bCentroidFour[0], bCentroidFour[1], bCentroidFour[2]));

    //Draw far objects first, while keeping equal-distance objects in a stable order
    return bDistance - aDistance;
  });

  // iterate over each object and render them
  sorted.map((object) => {
    gl.useProgram(object.programInfo.program);
    {

      //If transparency is below 1.0 (or turned on), apply depthMask
      if (object.material.alpha < 1.0 && !object.forceDepthWrite){
        gl.depthMask(false);
      } 
      
      //if object is 1.0, do not turn on depthMask since it does not need transparency
      else{
        gl.depthMask(true);
      }

      //A depth bias prevents two connected trails from competing for the same pixels
      if (object.depthBias) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(object.depthBias, object.depthBias);
      } else {
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }

      // Projection Matrix ....
      let projectionMatrix = mat4.create();
      let fovy = 90.0 * Math.PI / 180.0; // Vertical field of view in radians
      let aspect = state.canvas.clientWidth / state.canvas.clientHeight; // Aspect ratio of the canvas
      let near = 0.1; // Near clipping plane
      let far = 1000000.0; // Far clipping plane

      mat4.perspective(projectionMatrix, fovy, aspect, near, far);
      gl.uniformMatrix4fv(object.programInfo.uniformLocations.projection, false, projectionMatrix);
      state.projectionMatrix = projectionMatrix;

      // View Matrix & Camera ....
      let viewMatrix = mat4.create();
      let camFront = vec3.fromValues(0, 0, 0);
      vec3.add(camFront, state.camera.position, state.camera.front);
      mat4.lookAt(
        viewMatrix,
        state.camera.position,
        camFront,
        state.camera.up,
      );
      gl.uniformMatrix4fv(object.programInfo.uniformLocations.view, false, viewMatrix);
      gl.uniform3fv(object.programInfo.uniformLocations.cameraPosition, state.camera.position);
      state.viewMatrix = viewMatrix;

      // Model Matrix ....
      let modelMatrix = mat4.create();
      let negCentroid = vec3.fromValues(0.0, 0.0, 0.0);
      vec3.negate(negCentroid, object.centroid);
      mat4.translate(modelMatrix, modelMatrix, object.model.position);
      mat4.translate(modelMatrix, modelMatrix, object.centroid);
      mat4.mul(modelMatrix, modelMatrix, object.model.rotation);
      mat4.scale(modelMatrix, modelMatrix, object.model.scale);
      mat4.translate(modelMatrix, modelMatrix, negCentroid);

      if (object.parent) {
        let parent = getObject(state, object.parent);
        if (parent.model && parent.model.modelMatrix) {
          mat4.multiply(modelMatrix, parent.model.modelMatrix, modelMatrix);
        }
      }

      object.model.modelMatrix = modelMatrix;
      object.modelMatrix = modelMatrix;
      gl.uniformMatrix4fv(object.programInfo.uniformLocations.model, false, modelMatrix);

      // Normal Matrix ....
      let normalMatrix = mat4.create();
      mat4.invert(normalMatrix, modelMatrix);
      mat4.transpose(normalMatrix, normalMatrix);
      gl.uniformMatrix4fv(object.programInfo.uniformLocations.normalMatrix, false, normalMatrix);

      // Object material
      gl.uniform3fv(object.programInfo.uniformLocations.diffuseVal, object.material.diffuse);
      gl.uniform3fv(object.programInfo.uniformLocations.ambientVal, object.material.ambient);
      gl.uniform3fv(object.programInfo.uniformLocations.specularVal, object.material.specular);
      gl.uniform1f(object.programInfo.uniformLocations.nVal, object.material.n);

      //Pass the object's transparency value to the fragment shader
      gl.uniform1f(object.programInfo.uniformLocations.alphaVal,object.material.alpha);

      gl.uniform1i(object.programInfo.uniformLocations.numLights, state.numLights);
      if (state.pointLights.length > 0) {
        for (let i = 0; i < state.pointLights.length; i++) {
          gl.uniform3fv(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].position'), state.pointLights[i].position);
          gl.uniform3fv(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].colour'), state.pointLights[i].colour);
          gl.uniform1f(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].strength'), state.pointLights[i].strength);
          gl.uniform1f(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].linear'), state.pointLights[i].linear);
          gl.uniform1f(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].quadratic'), state.pointLights[i].quadratic);
        }
      }


      {
        // Bind the buffer we want to draw
        gl.bindVertexArray(object.buffers.vao);

        //check for diffuse texture and apply it
        

        if (object.material.shaderType === 2) {
          state.samplerExists = 1; 
          gl.activeTexture(gl.TEXTURE0); 
          gl.uniform1i(object.programInfo.uniformLocations.samplerExists, state.samplerExists);
          gl.uniform1i(object.programInfo.uniformLocations.sampler, 0);
          gl.bindTexture(gl.TEXTURE_2D, object.model.texture);
        } else {
          gl.activeTexture(gl.TEXTURE0);
          state.samplerExists = 0;
          gl.uniform1i(object.programInfo.uniformLocations.samplerExists, state.samplerExists);
        }
        
        if (object.material.shaderType === 3) {
          state.samplerNormExists = 1; 
          gl.activeTexture(gl.TEXTURE1); 
          gl.uniform1i(object.programInfo.uniformLocations.normalSamplerExists, state.samplerNormExists); 
          gl.uniform1i(object.programInfo.uniformLocations.normalSampler, 1); 
          gl.bindTexture(gl.TEXTURE_2D, object.model.textureNorm); 
        } else {
          gl.activeTexture(gl.TEXTURE0);
          state.samplerNormExists = 0;
          gl.uniform1i(object.programInfo.uniformLocations.normalSamplerExists, state.samplerNormExists);
        }

        // Draw the object
        const offset = 0; // Number of elements to skip before starting

        //if its a mesh then we don't use an index buffer and use drawArrays instead of drawElements
        if (object.type === "mesh" || object.type === "meshCustom") {
          gl.drawArrays(gl.TRIANGLES, offset, object.buffers.numVertices / 3);
        } else {
          gl.drawElements(gl.TRIANGLES, object.buffers.numVertices, gl.UNSIGNED_SHORT, offset);
        }
      }
    }
  });
}
