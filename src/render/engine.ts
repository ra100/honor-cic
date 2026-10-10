import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clampBloomHighPass, GRADE_CINEMATIC, GRADE_SHADER, type GradeProfile } from './grade';
import { setSpritePixelRatio } from './points';
import { Sky } from './sky';

/** Site A's clear colour; the sky pass paints over it. */
export const CLEAR_COLOR = 0x000003;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Site A's pass chain (A report §1.3): camera-locked sky, the view's scene on top, bloom on HDR targets,
 * then one grade pass that applies exposure, ACES, gamma, vignette and dither. There is no OutputPass.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly sky = new Sky();
  private readonly composer: EffectComposer;
  private readonly scenePass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly started = performance.now();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, logarithmicDepthBuffer: true,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(CLEAR_COLOR, 1);
    const gl2 = this.renderer.capabilities.isWebGL2;
    const hdr = gl2 && (this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float'));
    const target = new THREE.WebGLRenderTarget(4, 4, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: gl2 ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.sky.scene, this.sky.camera));
    this.scenePass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.scenePass.clear = false;
    this.scenePass.clearDepth = true;
    this.composer.addPass(this.scenePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), GRADE_CINEMATIC.bloomStrength, GRADE_CINEMATIC.bloomRadius, GRADE_CINEMATIC.bloomThreshold);
    const highPass = this.bloom.materialHighPassFilter;
    highPass.fragmentShader = clampBloomHighPass(highPass.fragmentShader);
    highPass.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.grade);
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    (this.grade.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, profile: GradeProfile = GRADE_CINEMATIC): void {
    // The sky shows through: views never paint a background of their own.
    scene.background = null;
    const pixelRatio = this.renderer.getPixelRatio();
    setSpritePixelRatio(scene, pixelRatio);
    const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    this.sky.sync(camera, pixelRatio);
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
    this.bloom.strength = profile.bloomStrength;
    this.bloom.radius = profile.bloomRadius;
    this.bloom.threshold = profile.bloomThreshold;
    this.bloom.enabled = profile.bloomStrength > 0;
    this.grade.uniforms.uExposure.value = profile.exposure;
    this.grade.uniforms.uVignette.value = profile.vignette;
    this.grade.uniforms.uT.value = ((performance.now() - this.started) / 1000) % 3600;
    this.composer.render();
  }

  dispose(): void {
    this.sky.dispose();
    this.bloom.dispose();
    this.grade.dispose?.();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
