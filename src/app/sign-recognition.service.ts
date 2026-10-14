import { Injectable } from '@angular/core';

/** اسم الكلاس في النموذج (labels.json) ← الحرف العربي. أضفت صيغ بديلة للأسماء المتقاربة */
const AR_LETTERS: Record<string, string> = {
  ALIF: 'ا', ALEF: 'ا', BAA: 'ب', BA: 'ب', TA: 'ت', THA: 'ث', JEEM: 'ج', JIM: 'ج', HAA: 'ح',
  KHAA: 'خ', DELL: 'د', DAL: 'د', DHELL: 'ذ', THAL: 'ذ', RAA: 'ر', ZAY: 'ز', SEEN: 'س',
  SHEEN: 'ش', SAD: 'ص', SAAD: 'ص', DAD: 'ض', DHAD: 'ض', TAA: 'ط', TAH: 'ط', DHAA: 'ظ', ZAH: 'ظ',
  AIN: 'ع', AYN: 'ع', GHAIN: 'غ', GHAYN: 'غ', FA: 'ف', FAA: 'ف', QAF: 'ق', QAAF: 'ق',
  KAF: 'ك', KAAF: 'ك', LAM: 'ل', LAAM: 'ل', MEEM: 'م', NOON: 'ن', HA: 'ه', WAW: 'و', YA: 'ي', YAA: 'ي',
};

export interface Prediction {
  label: string;
  arabic: string;
  confidence: number;
}

export interface SignCallbacks {
  /** يُستدعى كل دورة. p = null إذا ما فيه يد. progress من 0 إلى 1 */
  onPredict?: (p: Prediction | null, progress: number) => void;
  /** يُستدعى لما يتأكد الحرف */
  onLetter: (arabicLetter: string) => void;
}

const SIZE = 224;
const CONF_THRESHOLD = 0.7;
const FRAMES_NEEDED = 5;      // عدد التوقعات المتتالية لتأكيد الحرف
const NO_HAND_LIMIT = 3;      // دورات بدون يد قبل السماح بحرف جديد
const INTERVAL_MS = 100;      // كل كم ms يتم التعرف

/** المكتبتان تنحمّلان من CDN وقت التشغيل (بدون npm وبدون bundling)،
 *  عشان سيرفر التطوير ما يحتاج يجهّزهم ويستهلك ذاكرة الجهاز. */
const ORT_VERSION = '1.20.1';
const MP_VERSION = '0.10.18';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

@Injectable({ providedIn: 'root' })
export class SignRecognitionService {
  /** نفس قلب الصورة في برنامج Python (cv2.flip). غيّره إلى false لو الدقة ضعيفة */
  mirror = true;
  ready = false;

  private ort: any;
  private session: any;
  private landmarker: any;
  private labels: string[] = [];
  private needSoftmax = false;
  private warned = new Set<string>();
  private running = false;
  private timer: any;

  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  /** ينفّذ خطوة ويكتب نجاحها/فشلها في Console، وإذا فشلت يرمي خطأ باسم الخطوة */
  private async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      console.info('[sign] ✔', name);
      return r;
    } catch (e) {
      console.error('[sign] ✘', name, e);
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('تعذّر تحميل ' + src + ' (تأكد من الإنترنت)'));
      document.head.appendChild(s);
    });
  }

  async init(): Promise<void> {
    if (this.ready) return;
    const base = document.baseURI;
    const url = (p: string) => new URL(p, base).href;

    // 1) ONNX Runtime من CDN
    await this.step('تحميل مكتبة onnxruntime-web (CDN)', () => this.loadScript(ORT_CDN + 'ort.wasm.min.js'));   // نسخة wasm فقط: أخف بكثير على الذاكرة
    const ort: any = (window as any).ort;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = ORT_CDN;
    this.ort = ort;

    // 2) نموذج YOLO
    this.session = await this.step('تحميل models/best.onnx', () =>
      ort.InferenceSession.create(url('models/best.onnx'), { executionProviders: ['wasm'] }));

    // 3) أسماء الكلاسات بنفس ترتيب الموديل
    const names = await this.step('قراءة models/labels.json', async () => (await fetch(url('models/labels.json'))).json());
    this.labels = Object.keys(names).sort((a, b) => Number(a) - Number(b)).map((k) => names[k]);
    const unmapped = this.labels.filter((l) => !(l in AR_LETTERS));
    if (unmapped.length) console.warn('[sign] كلاسات ما لها حرف عربي (أضيفيها في AR_LETTERS):', unmapped);

    // 4) تشغيل تجريبي: نتأكد إن الشكل صح (224، وعدد الكلاسات، واحتمالات مو أرقام خام)
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    await this.step('تشغيل تجريبي للنموذج', async () => {
      const t = new ort.Tensor('float32', new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]);
      const out = await this.session.run({ [this.session.inputNames[0]]: t });
      const p = out[this.session.outputNames[0]].data as Float32Array;
      if (p.length !== this.labels.length) {
        throw new Error(`عدد مخرجات النموذج (${p.length}) لا يساوي عدد الكلاسات في labels.json (${this.labels.length})`);
      }
      const sum = p.reduce((a, b) => a + b, 0);
      this.needSoftmax = Math.abs(sum - 1) > 0.05;     // لو المخرجات أرقام خام نطبّق softmax بأنفسنا
      console.info('[sign] مدخل:', this.session.inputNames, 'مخرج:', this.session.outputNames, '| softmax مطلوب:', this.needSoftmax);
    });

    // 5) كاشف اليد (MediaPipe) من CDN
    const mpUrl = `${MP_CDN}/vision_bundle.mjs`;
    const mp: any = await this.step('تحميل مكتبة MediaPipe (CDN)', () => import(/* @vite-ignore */ mpUrl));
    this.landmarker = await this.step('تهيئة كاشف اليد', async () => {
      const fileset = await mp.FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
      return mp.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: url('models/hand_landmarker.task'), delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
    });

    this.ready = true;
  }

  start(video: HTMLVideoElement, cb: SignCallbacks): void {
    this.stop();
    this.running = true;

    let last = '';
    let count = 0;
    let added = false;
    let noHand = 0;

    const loop = async () => {
      if (!this.running) return;
      try {
        const { hand, pred } = await this.predict(video);

        if (!hand) {
          noHand++;
          if (noHand >= NO_HAND_LIMIT) {
            added = false;
            last = '';
            count = 0;
          }
          cb.onPredict?.(null, 0);
        } else {
          noHand = 0;
          if (!added && pred && pred.confidence > CONF_THRESHOLD) {
            if (pred.label !== last) {
              last = pred.label;
              count = 0;
            }
            count++;
            cb.onPredict?.(pred, Math.min(count / FRAMES_NEEDED, 1));
            if (count >= FRAMES_NEEDED) {
              added = true;
              cb.onLetter(pred.arabic);
            }
          }
        }
      } catch (e) {
        console.error('[sign] خطأ أثناء التعرّف', e);
      }
      this.timer = setTimeout(loop, INTERVAL_MS);
    };
    loop();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  private async predict(video: HTMLVideoElement): Promise<{ hand: boolean; pred: Prediction | null }> {
    if (!this.ready || video.readyState < 2 || !video.videoWidth) {
      return { hand: false, pred: null };
    }

    // 1) هل فيه يد؟
    const res = this.landmarker.detectForVideo(video, performance.now());
    if (!res.landmarks?.length) return { hand: false, pred: null };

    // 2) قص مربع من منتصف الفيديو (مثل ما يسوي YOLO) وتصغيره إلى 224
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const s = Math.min(vw, vh);
    this.ctx.save();
    if (this.mirror) {
      this.ctx.translate(SIZE, 0);
      this.ctx.scale(-1, 1);
    }
    this.ctx.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, SIZE, SIZE);
    this.ctx.restore();

    // 3) RGB، قيم من 0 إلى 1، ترتيب CHW
    const { data } = this.ctx.getImageData(0, 0, SIZE, SIZE);
    const n = SIZE * SIZE;
    const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      input[i] = data[i * 4] / 255;
      input[n + i] = data[i * 4 + 1] / 255;
      input[2 * n + i] = data[i * 4 + 2] / 255;
    }

    // 4) تشغيل الموديل
    const tensor = new this.ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
    const out = await this.session.run({ [this.session.inputNames[0]]: tensor });
    let probs = out[this.session.outputNames[0]].data as Float32Array;
    if (this.needSoftmax) {
      const mx = Math.max(...probs);
      const ex = Array.from(probs, (v) => Math.exp(v - mx));
      const sum = ex.reduce((a, b) => a + b, 0);
      probs = Float32Array.from(ex, (v) => v / sum);
    }

    let best = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[best]) best = i;
    }
    const label = this.labels[best];
    const arabic = AR_LETTERS[label];
    if (!arabic && !this.warned.has(label)) {
      this.warned.add(label);
      console.warn('[sign] الكلاس ما له حرف عربي:', label);
    }
    return { hand: true, pred: { label, arabic: arabic ?? label, confidence: probs[best] } };
  }
}