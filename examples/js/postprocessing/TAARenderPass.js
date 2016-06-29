/**
 *
 * Temporal Anti-Aliasing Render Pass
 *
 * @author bhouston / http://clara.io/
 *
 * When there is no motion in the scene, the TAA render pass accumulates jittered camera samples across frames to create a high quality anti-aliased result.
 *
 * References:
 *
 * TODO: Add support for motion vector pas so that accumulation of samples across frames can occur on dynamics scenes.
 *
 */

THREE.TAARenderPass = function( scene, camera ) {

	THREE.Pass.call( this );

	this.scene = scene;
	this.camera = camera;

	if ( THREE.CopyShader === undefined ) console.error( "THREE.TAARenderPass relies on THREE.CopyShader" );

	var copyShader = THREE.CopyShader;
	this.copyUniforms = THREE.UniformsUtils.clone( copyShader.uniforms );

	this.copyMaterial = new THREE.ShaderMaterial( {
		uniforms: this.copyUniforms,
		vertexShader: copyShader.vertexShader,
		fragmentShader: copyShader.fragmentShader,
		premultipliedAlpha: true,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthTest: false,
		depthWrite: false
	} );

	this.camera2 = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
	this.scene2	= new THREE.Scene();
	this.quad2 = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), this.copyMaterial );
	this.scene2.add( this.quad2 );

	this.sampleLevel = 0;
	this.maxSampleLevel = 5;
	this.accumulate = false;
	this.accumulateIndex = 0;

	this.onRenderedCallback = null;

};


THREE.TAARenderPass.prototype = Object.assign( Object.create( THREE.Pass.prototype ), {

	constructor: THREE.TAARenderPass,

	render: function( renderer, writeBuffer, readBuffer, delta ) {

		var jitterOffsets = THREE.TAARenderPass.JitterVectors[ this.maxSampleLevel ];
		var totalSamples = jitterOffsets.length;
		var numSamplesPerFrame = Math.pow( 2, this.sampleLevel );

		// if no accumulation, clamp totalSamples
		if ( ! this.accumulate ) {

			jitterOffsets = THREE.TAARenderPass.JitterVectors[ this.sampleLevel ];
			totalSamples = jitterOffsets.length;

			this.accumulateIndex = 0;

		}

		if ( ! this.sampleRenderTarget ) {

			this.sampleRenderTarget = new THREE.WebGLRenderTarget( readBuffer.width, readBuffer.height );

		}

		if ( ! this.holdRenderTarget ) {

			this.holdRenderTarget = new THREE.WebGLRenderTarget( readBuffer.width, readBuffer.height );

		}

		var autoClear = renderer.autoClear;
		renderer.autoClear = false;

		var jitterFactor = 1 / 16 / renderer.getPixelRatio();

		var oldClearColorHex = renderer.getClearColor().getHex();
		var oldClearAlpha = renderer.getClearAlpha();

		if ( this.accumulateIndex < totalSamples ) {

			// render the scene multiple times, each slightly jitter offset from the last and accumulate the results.
			for ( var i = 0; i < numSamplesPerFrame; i ++ ) {

				var jitterOffset = jitterOffsets[ this.accumulateIndex ];

				if ( this.camera.setViewOffset ) {

					this.camera.setViewOffset( readBuffer.width, readBuffer.height,
						jitterOffset[ 0 ] * jitterFactor, jitterOffset[ 1 ] * jitterFactor,
						readBuffer.width, readBuffer.height );

				}

				// render on transparent sampleRenderTarget
				renderer.setClearColor( 0x000000, 0.0 );
				renderer.render( this.scene, this.camera, this.sampleRenderTarget, true );

				// copy fresh sample to writeBuffer with descending weighting as accumulateIndex grows
				this.copyUniforms[ "tDiffuse" ].value = this.sampleRenderTarget.texture;
				this.copyUniforms[ "opacity" ].value = 1.0 / ( this.accumulateIndex + 1 );
				renderer.render( this.scene2, this.camera2, writeBuffer, true );

				// copy previous result also
				this.copyUniforms[ "tDiffuse" ].value = this.holdRenderTarget.texture;
				this.copyUniforms[ "opacity" ].value = 1.0 - 1.0 / ( this.accumulateIndex + 1 );
				renderer.render( this.scene2, this.camera2, writeBuffer, false );

				// copy accumulated result to the holdRenderTarget
				this.copyUniforms[ "tDiffuse" ].value = writeBuffer.texture;
				this.copyUniforms[ "opacity" ].value = 1.0;
				renderer.render( this.scene2, this.camera2, this.holdRenderTarget, true );

				this.accumulateIndex ++;

			}

			// now blend with clearColor
			this.copyMaterial.blending = THREE.NormalBlending;
			renderer.setClearColor( oldClearColorHex, oldClearAlpha );
			this.copyUniforms[ "tDiffuse" ].value = this.holdRenderTarget.texture;
			this.copyUniforms[ "opacity" ].value = 1.0;
			renderer.render( this.scene2, this.camera2, writeBuffer, true );
			this.copyMaterial.blending = THREE.AdditiveBlending;

			if ( this.camera.clearViewOffset )
				this.camera.clearViewOffset();

			if ( this.onRenderedCallback && this.accumulateIndex >= totalSamples ) {

				this.onRenderedCallback();

			}

		}

		renderer.autoClear = autoClear;
		renderer.setClearColor( oldClearColorHex, oldClearAlpha );

	},

	resize: function() {

		this.holdRenderTarget = null;
		this.sampleRenderTarget = null;
		this.accumulateIndex = 0;

	},

	resetAccumulationIndex: function() {

		this.accumulateIndex = 0;

	},

	setAccumulation: function( doAccumulation ) {

		if ( this.accumulate != doAccumulation ) {

			this.resetAccumulationIndex();

		}

		this.accumulate = doAccumulation;

	}

} );


// These jitter vectors are specified in integers because it is easier.
// I am assuming a [-8,8) integer grid, but it needs to be mapped onto [-0.5,0.5)
// before being used, thus these integers need to be scaled by 1/16.
//
// Sample patterns reference: https://msdn.microsoft.com/en-us/library/windows/desktop/ff476218%28v=vs.85%29.aspx?f=255&MSPPError=-2147217396

THREE.TAARenderPass.JitterVectors = [
	[
		[ 0, 0 ]
	],
	[
		[ 4, 4 ], [ - 4, - 4 ]
	],
	[
		[ - 2, - 6 ], [ 6, - 2 ], [ - 6, 2 ], [ 2, 6 ]
	],
	[
		[ 1, - 3 ], [ - 1, 3 ], [ 5, 1 ], [ - 3, - 5 ],
		[ - 5, 5 ], [ - 7, - 1 ], [ 3, 7 ], [ 7, - 7 ]
	],
	[
		[ 1, 1 ], [ - 1, - 3 ], [ - 3, 2 ], [ 4, - 1 ],
		[ - 5, - 2 ], [ 2, 5 ], [ 5, 3 ], [ 3, - 5 ],
		[ - 2, 6 ], [ 0, - 7 ], [ - 4, - 6 ], [ - 6, 4 ],
		[ - 8, 0 ], [ 7, - 4 ], [ 6, 7 ], [ - 7, - 8 ]
	],
	[
		[ - 4, - 7 ], [ - 7, - 5 ], [ - 3, - 5 ], [ - 5, - 4 ],
		[ - 1, - 4 ], [ - 2, - 2 ], [ - 6, - 1 ], [ - 4, 0 ],
		[ - 7, 1 ], [ - 1, 2 ], [ - 6, 3 ], [ - 3, 3 ],
		[ - 7, 6 ], [ - 3, 6 ], [ - 5, 7 ], [ - 1, 7 ],
		[ 5, - 7 ], [ 1, - 6 ], [ 6, - 5 ], [ 4, - 4 ],
		[ 2, - 3 ], [ 7, - 2 ], [ 1, - 1 ], [ 4, - 1 ],
		[ 2, 1 ], [ 6, 2 ], [ 0, 4 ], [ 4, 4 ],
		[ 2, 5 ], [ 7, 5 ], [ 5, 6 ], [ 3, 7 ]
	]
];

// sort by distance, short jitters first
for ( var j = 0; j < THREE.TAARenderPass.JitterVectors.length; j ++ ) {

	THREE.TAARenderPass.JitterVectors[ j ].sort( function( a, b ) {

		return ( a[ 0 ] * a[ 0 ] + a[ 1 ] * a[ 1 ] ) - ( b[ 0 ] * b[ 0 ] + b[ 1 ] * b[ 1 ] );

	} );

}
