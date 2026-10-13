import { Component, ElementRef, HostListener, afterNextRender, computed, signal, viewChild } from '@angular/core';
import { Hand } from './hand';
import { Reveal } from './reveal';
import { Sheet } from './sheet';

interface Sign { c: string; id: string; name: string; }

const L: [string, string, string][] = [
  ['ا','alef','ألف'], ['ب','baa','باء'], ['ت','taa','تاء'], ['ث','thaa','ثاء'],
  ['ج','jeem','جيم'], ['ح','haa','حاء'], ['خ','khaa','خاء'], ['د','dal','دال'],
  ['ذ','thal','ذال'], ['ر','raa','راء'], ['ز','zay','زاي'], ['س','seen','سين'],
  ['ش','sheen','شين'], ['ص','saad','صاد'], ['ض','dhad','ضاد'], ['ط','tah','طاء'],
  ['ظ','zah','ظاء'], ['ع','ain','عين'], ['غ','ghain','غين'], ['ف','fa','فاء'],
  ['ق','qaf','قاف'], ['ك','kaf','كاف'], ['ل','lam','لام'], ['م','meem','ميم'],
  ['ن','noon','نون'], ['ه','ha','هاء'], ['و','waw','واو'], ['ي','ya','ياء'],
];
const NORM: Record<string, string> = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه',
};
const ROWS = ['ضصثقفغعهخحجد', 'شسيبلاتنمكط', 'ذرزوظ'];   // صفوف الكيبورد
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

@Component({
  selector: 'app-root',
  imports: [Hand, Reveal, Sheet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  letters: Sign[] = L.map(([c, id, name]) => ({ c, id, name }));
  rows: Sign[][] = ROWS.map((r) => [...r].map((ch) => this.letters.find((l) => l.c === ch)!));

  titleLines = [[...'إشــارتك'], [...'صــوتك']];        // سطرا العنوان (ـ = مدّ)
  sentence = 'بإشارة من يدك يسمعك الجميع';
  words = this.sentence.split(' ').map((w) => w.split(''));
  // الترتيب: الرئيسية ← الإشارات ← الحروف ← الكيبورد ← الكاميرا
  nav = [
    { id: 'home', t: 'الرئيسية' },
    { id: 'try', t: 'الإشارات' },
    { id: 'letters', t: 'الحروف' },
    { id: 'keys', t: 'الكيبورد' },
    { id: 'camera', t: 'الكاميرا' },
  ];

  heroActive = signal<Sign>(this.sign('ش')!);
  sentenceActive = signal<Sign>(this.sign('ب')!);
  gridActive = signal<Sign>(this.letters[0]);

  // ---------- الكيبورد ----------
  typed = signal<(Sign | null)[]>([]);
  kbActive = signal<Sign | null>(null);
  down = signal('');
  press(s: Sign): void {
    this.typed.update((t) => [...t.slice(-11), s]);
    this.kbActive.set(s);
    this.down.set(s.id);
    setTimeout(() => this.down.set(''), 180);
  }
  space(): void { this.typed.update((t) => [...t.slice(-11), null]); }
  back(): void { this.typed.update((t) => t.slice(0, -1)); }
  @HostListener('window:keydown', ['$event']) onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // الكيبورد لازم يكون هو الظاهر بنص الشاشة (مو مغطّى بسكشن ثاني)
    const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (!mid?.closest('.keys')) return;
    if (e.key === ' ') { e.preventDefault(); this.space(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); this.back(); return; }
    const s = this.sign(e.key);
    if (s) this.press(s);
  }

  // ---------- ظهور الأيدي بعد التحميل + يد تتبع الماوس على العنوان ----------
  shown = signal(false);
  follow = signal({ x: 0, y: 0, on: false });
  private tapT?: ReturnType<typeof setTimeout>;
  onTitleMove(e: MouseEvent): void { this.follow.set({ x: e.clientX, y: e.clientY, on: true }); }
  onTitleLeave(): void { this.follow.update((f) => ({ ...f, on: false })); this.hot.set(false); }
  tap(e: MouseEvent): void {                       // للمس: تظهر ثواني ثم تختفي
    this.onTitleMove(e);
    clearTimeout(this.tapT);
    this.tapT = setTimeout(() => this.onTitleLeave(), 1800);
  }

  private reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- الكاميرا (جاهزة لنموذج التعلّم الآلي) ----------
  vid = viewChild<ElementRef<HTMLVideoElement>>('vid');
  camOn = signal(false);
  camMsg = signal('');
  detected = signal<Sign | null>(null);
  private stream?: MediaStream;

  async toggleCam(): Promise<void> {
    if (this.camOn()) { this.stopCam(); return; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      const v = this.vid()?.nativeElement;
      if (v) { v.srcObject = this.stream; await v.play(); }
      this.camOn.set(true);
      this.camMsg.set('');
      // TODO (نموذج التعلّم الآلي): هنا تبدأ حلقة التعرّف.
      // لكل إطار من الفيديو `v` مرّره لنموذجك، وإذا عرف حرفاً استدعي: this.showDetected('ب')
    } catch {
      this.camMsg.set('تعذّر تشغيل الكاميرا، اسمح للمتصفح باستخدامها.');
    }
  }
  stopCam(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    const v = this.vid()?.nativeElement;
    if (v) v.srcObject = null;
    this.camOn.set(false);
    this.detected.set(null);
  }
  /** يستدعيها نموذجك عند التعرّف على حرف (مثلاً 'ب') */
  showDetected(ch: string): void { this.detected.set(this.sign(ch) ?? null); }

  // ---------- الشعار ----------
  logos = ['asl-logo.jpeg', 'asl-logo.jpg', 'asl-logo.png', 'asl-logo.svg', 'asl-logo.webp', 'logo.png', 'logo.svg', 'logo.jpg', 'asl_logo.png', 'asl_logo.jpg', 'asl_logo.svg'];
  logoIdx = signal(0);
  logoOk = signal(false);
  logo = computed(() => this.logos[this.logoIdx()]);
  logoFail(): void { this.logoIdx.update((i) => i + 1); }

  // ---------- السكرول ----------
  current = signal('home');
  light = signal(true);                   // الهيدر فوق خلفية فاتحة؟
  prog = signal(0);                       // تقدّم السكرول داخل الهيرو (0 ← 1)
  stripLetters: Sign[] = [...this.letters].reverse();   // من اليسار (ي) إلى اليمين (ا)
  stripEl = viewChild<ElementRef<HTMLElement>>('strip');
  private userOffset = 0;                 // سحب المستخدم (موجب = الأيدي لليمين)
  private dragX: number | null = null;
  private dragBase = 0;

  /** شريط الأيدي يتحرك بـ transform (مو scrollLeft) فالهامش ثابت ومتساوي يمين ويسار:
   *  البداية: الألف ملتصقة بالهامش اليمين، والنهاية: الياء بالهامش اليسار.
   *  الضباب (mask) متماثل في الـ CSS. إذا كل الأيدي تسع الشاشة تتوسّط. */
  private applyStrip(): void {
    const el = this.stripEl()?.nativeElement;
    const trk = el?.firstElementChild as HTMLElement | null;
    if (!el || !trk) return;
    const W = el.clientWidth;
    const T = trk.offsetWidth;
    const m = Math.round(Math.min(36, W * 0.03));              // هامش قصير ومتساوي من الجهتين
    const base = W - T - m;                                    // الألف عند الهامش اليمين
    const end = m;                                             // الياء عند الهامش اليسار
    if (base >= end) { trk.style.transform = `translate3d(${(W - T) / 2}px,0,0)`; return; }
    const auto = this.prog() * (end - base);                   // كل الأيدي تمر مع السكرول (من الألف لين الياء)
    this.userOffset = clamp(this.userOffset, -auto, end - base - auto);
    trk.style.transform = `translate3d(${clamp(base + auto + this.userOffset, base, end)}px,0,0)`;
  }
  dragStart(e: PointerEvent): void {
    this.dragX = e.clientX; this.dragBase = this.userOffset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  dragMove(e: PointerEvent): void {
    if (this.dragX !== null) { this.userOffset = this.dragBase + e.clientX - this.dragX; this.applyStrip(); }
  }
  dragEnd(): void { this.dragX = null; }
  onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); this.userOffset -= e.deltaX; this.applyStrip(); }
  }
  @HostListener('window:resize') onResize(): void { this.applyStrip(); this.onScroll(); }

  // الحرف يبقى أزرق فقط أثناء التمرير عليه ثم يرجع أسود
  hot = signal(false);
  pick(s: Sign): void { this.heroActive.set(s); this.hot.set(true); }
  constructor() {
    afterNextRender(() => {
      this.onScroll();
      const trk = this.stripEl()?.nativeElement.firstElementChild;
      if (trk) new ResizeObserver(() => this.applyStrip()).observe(trk);   // يعيد الضبط لما تتحمل صور الأيدي
      this.applyStrip();
      setTimeout(() => this.shown.set(true), 150);
    });
  }
  @HostListener('window:scroll') onScroll(): void {
    const hero = document.getElementById('home');
    if (hero) {
      const total = hero.offsetHeight - (parseFloat(getComputedStyle(hero).paddingBottom) || 0) - window.innerHeight;
      this.prog.set(total > 100 && !this.reduce ? clamp(window.scrollY / total, 0, 1) : 0);
      // الأيدي تطلع مرة وحدة عند التحميل وتبقى ثابتة (ما تنخفي ولا تنزل وتطلع من جديد)
      if (window.scrollY < 8) this.userOffset = 0;                                 // أول الصفحة: ترجع لمكانها الأصلي
    }
    this.applyStrip();

    // القسم الحالي في النافبار
    let cur = 'home';
    for (const n of this.nav) {
      const el = document.getElementById(n.id);
      if (el && el.getBoundingClientRect().top <= 160) cur = n.id;
    }

    // لون الهيدر: حسب الخلفية تحته (والفاصل المتدرّج: نص أبيض بعد منتصفه)
    const y = 44;
    let dark = false;
    document.querySelectorAll<HTMLElement>('[data-bg]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top > y || r.bottom <= y) return;
      const bg = el.dataset['bg'];
      if (bg === 'dark') dark = true;
      else if (bg === 'light') dark = false;
      else dark = bg === 'to-dark' ? (y - r.top) / r.height > 0.5 : (y - r.top) / r.height <= 0.5;
    });
    // كارد أبيض تحت الهيدر؟ => نص أسود
    const top = document.elementsFromPoint(window.innerWidth / 2, y).filter((e) => !e.closest('.top'))[0];
    if (top?.closest('[data-card]')) dark = false;
    this.current.set(cur);
    this.light.set(!dark);
  }

  sign(ch: string): Sign | undefined {
    const k = NORM[ch] ?? ch;
    return this.letters.find((l) => l.c === k);
  }
  hoverHero(ch: string): void { const s = this.sign(ch); if (s) this.pick(s); }
  isHero(ch: string): boolean { return this.hot() && this.sign(ch) === this.heroActive(); }
  hoverSentence(ch: string): void { const s = this.sign(ch); if (s) this.sentenceActive.set(s); }
  isOn(ch: string): boolean { return this.sign(ch) === this.sentenceActive(); }

  /** روابط النافبار: السكشن المثبّت (sticky) موضعه الحالي مو الأصلي، فننزل لعلامته الأصلية بدل الـ id */
  goto(e: Event, id: string): void {
    const behavior: ScrollBehavior = this.reduce ? 'auto' : 'smooth';
    window.dispatchEvent(new Event('stk-nav'));                      // يوقف الحركة التلقائية أثناء التنقّل
    if (id === 'home') { e.preventDefault(); window.scrollTo({ top: 0, behavior }); return; }
    const a = document.querySelector<HTMLElement>(`.stk-anchor[data-for="${id}"]`);
    if (!a) return;
    e.preventDefault();
    const overlap = parseFloat(getComputedStyle(a.nextElementSibling as Element).marginTop) || 0;   // سالب = بقدر الزاوية
    const extra = id === 'camera' ? (document.getElementById('cam-start')?.offsetTop ?? 0) - 40 : 0;   // الكاميرا: ننزل لبداية الكاميرا مو لشرح الموديل
    window.scrollTo({ top: Math.max(0, a.getBoundingClientRect().top + window.scrollY + overlap + extra), behavior });
  }
}