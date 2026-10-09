import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { PALETTE } from './palette';
import { setSpritePixelRatio } from './points';

export const BLOOM = { strength: 0.45, radius: 0.25, threshold: 1 } as const;

export function ensureVoidBackground(scene: THREE.Scene): void {
  // RenderPass clears before WebGLBackground sets target-linear clear RGB. An explicit background forces the corrected clear.
  if (scene.background === null) scene.background = new THREE.Color(PALETTE.void);
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly pass: RenderPass;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, logarithmicDepthBuffer: true,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(PALETTE.void, 1);
    this.composer = new EffectComposer(this.renderer);
    this.pass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.pass);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    ensureVoidBackground(scene);
    setSpritePixelRatio(scene, this.renderer.getPixelRatio());
    const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    this.pass.scene = scene;
    this.pass.camera = camera;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
  }
}
