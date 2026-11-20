import { type ChangeEvent, useEffect, useState } from 'react';
import type {
  ActionResponse,
  AnswerMode,
  DifficultyLevel,
  FontPairId,
  GameSettings,
  GameState,
  OptionLetter,
  PlayMode,
  ThemeId,
} from '../types/game';
import { downloadExcelTemplate, parseExcelQuestionsFile } from '../utils/excel';

interface SettingsViewProps {
  gameState: GameState;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<ActionResponse>;
  onToast: (msg: string) => void;
}

const THEME_PRESETS: { id: ThemeId; name: string; desc: string }[] = [
  { id: 'luxury', name: 'النهاري الفاخر', desc: 'ورق دافئ وعنبر ذهبي (افتراضي)' },
  { id: 'snow', name: 'النهاري الثلجي', desc: 'أبيض ناصع وأزرق سماوي' },
  { id: 'sunrise', name: 'الشروق الدافئ', desc: 'برتقالي ناعم عالي التباين' },
  { id: 'azure', name: 'الأزرق الفاتح', desc: 'أزرق سماوي هادئ' },
  { id: 'lavender', name: 'البنفسجي الهادئ', desc: 'أرجواني ناعم متباين' },
  { id: 'classic', name: 'الليلي الكلاسيكي', desc: 'مسرح داكن بوضوح ليلي' },
];

const CUSTOM_COLOR_TOKENS: { key: string; label: string }[] = [
  { key: '--bg-canvas', label: 'خلفية المسرح' },
  { key: '--bg-card', label: 'خلفية البطاقات' },
  { key: '--border-subtle', label: 'لون الحدود' },
  { key: '--text-primary', label: 'النص الرئيسي' },
  { key: '--text-secondary', label: 'النص الثانوي' },
  { key: '--icon-container-bg', label: 'خلفية الشارات' },
  { key: '--icon-primary', label: 'اللون البارز' },
  { key: '--buzzer-border', label: 'إطار الضاغط' },
];

function cssColorToHex(rawColor: string): string {
  const val = rawColor.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return val;
  const match = val.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (match) {
    const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
  }
  return '';
}

export function SettingsView({ gameState, onAction, onToast }: SettingsViewProps) {
  const [formSettings, setFormSettings] = useState<GameSettings>(gameState.settings);
  const [newRound, setNewRound] = useState<string>('الجولة 1');
  const [newCategory, setNewCategory] = useState<string>('ثقافة عامة');
  const [newDifficulty, setNewDifficulty] = useState<DifficultyLevel>('سهل');
  const [newQuestion, setNewQuestion] = useState<string>('');
  const [newOptA, setNewOptA] = useState<string>('');
  const [newOptB, setNewOptB] = useState<string>('');
  const [newOptC, setNewOptC] = useState<string>('');
  const [newCorrect, setNewCorrect] = useState<OptionLetter>('A');
  const [newImageUrl, setNewImageUrl] = useState<string>('');
  const [newAudioUrl, setNewAudioUrl] = useState<string>('');
  const [newExplanation, setNewExplanation] = useState<string>('');
  const [importing, setImporting] = useState<boolean>(false);
  const [newHostPin, setNewHostPin] = useState<string>('');
  const [showPinInput, setShowPinInput] = useState<boolean>(false);
  const [computedTokenHexes, setComputedTokenHexes] = useState<Record<string, string>>({});

  useEffect(() => {
    setFormSettings(gameState.settings);
  }, [gameState.settings]);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const map: Record<string, string> = {};
    for (const item of CUSTOM_COLOR_TOKENS) {
      const hex = cssColorToHex(styles.getPropertyValue(item.key));
      if (hex) map[item.key] = hex;
    }
    setComputedTokenHexes(map);
  }, [gameState.activeTheme, gameState.customTokens]);

  const handleSaveSettings = async () => {
    const trimmedPin = newHostPin.trim();
    const res = await onAction('SAVE_SETTINGS', {
      settings: formSettings,
      ...(trimmedPin ? { newHostPin: trimmedPin } : {}),
    });
    if (res.status === 'OK') {
      setNewHostPin('');
      onToast(
        trimmedPin
          ? '✅ تم حفظ الإعدادات وتفعيل رمز حماية المذيع'
          : '✅ تم حفظ الإعدادات وتطبيقها لحظياً على جميع الشاشات'
      );
    } else if (res.message) {
      onToast(res.message);
    }
  };

  const handleClearHostPin = async () => {
    const res = await onAction('SAVE_SETTINGS', {
      settings: formSettings,
      clearHostPin: true,
    });
    if (res.status === 'OK') {
      setNewHostPin('');
      onToast('🔓 تم إزالة رمز حماية المذيع — يمكنه الآن إظهار الإجابات مباشرة');
    } else if (res.message) {
      onToast(res.message);
    }
  };

  const handleThemeSelect = async (themeId: ThemeId) => {
    const res = await onAction('UPDATE_VISUAL_THEME', {
      activeTheme: themeId,
      customTokens: {},
    });
    if (res.status === 'OK') {
      onToast('✅ تم تعميم السمة البصرية الجديدة على جميع الأجهزة');
    }
  };

  const handleTokenColorChange = async (tokenKey: string, value: string) => {
    const nextTokens = { ...gameState.customTokens, [tokenKey]: value };
    await onAction('UPDATE_VISUAL_THEME', {
      activeTheme: gameState.activeTheme,
      customTokens: nextTokens,
    });
  };

  const handleResetTokens = async () => {
    await onAction('UPDATE_VISUAL_THEME', {
      activeTheme: gameState.activeTheme,
      customTokens: {},
    });
    onToast('🎨 تمت استعادة ألوان السمة الأصلية');
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.trim() || !newOptA.trim() || !newOptB.trim() || !newOptC.trim()) {
      onToast('⚠️ أكمل نص السؤال وجميع الخيارات الثلاثة');
      return;
    }
    const res = await onAction('ADD_QUESTION', {
      round: newRound,
      category: newCategory,
      difficulty: newDifficulty,
      question: newQuestion,
      optA: newOptA,
      optB: newOptB,
      optC: newOptC,
      correct: newCorrect,
      imageUrl: newImageUrl.trim(),
      audioUrl: newAudioUrl.trim(),
      explanation: newExplanation.trim(),
    });
    if (res.status === 'OK') {
      setNewQuestion('');
      setNewOptA('');
      setNewOptB('');
      setNewOptC('');
      setNewImageUrl('');
      setNewAudioUrl('');
      setNewExplanation('');
      onToast(res.message || '✅ تمت إضافة السؤال');
    } else if (res.message) {
      onToast(res.message);
    }
  };

  const handleExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const rows = await parseExcelQuestionsFile(file);
      if (rows.length === 0) {
        onToast('⚠️ لم يتم العثور على صفوف أسئلة صالحة في الملف');
        return;
      }
      const res = await onAction('BULK_IMPORT_QUESTIONS', { rows });
      if (res.status === 'OK') {
        onToast(`✅ تم استيراد وحفظ (${res.importedCount || rows.length}) سؤالاً بنجاح`);
      } else if (res.message) {
        onToast(res.message);
      }
    } catch (err) {
      console.error('Excel upload error:', err);
      onToast('❌ تعذرت قراءة ملف Excel — تأكد من مطابقة الأعمدة للنموذج');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const teamIndices = Array.from({ length: formSettings.teamCount }, (_, i) => i + 1);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5">
      {/* ARIA Live Region for Settings */}
      <div
        id="settings-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      {/* 1. القواعد العامة للبطولة والفرق */}
      <section className="surface-card rounded-3xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-black text-primary-token">
              ⚙️ استوديو الإعدادات وبنك الأسئلة
            </h1>
            <p className="text-xs font-bold text-secondary-token">
              جميع التعديلات تحفظ تلقائياً في الخادم وتنعكس فوراً على شاشة البث والهواتف.
            </p>
          </div>
          <button type="button" onClick={() => void handleSaveSettings()} className="btn-token btn-primary-token">
            💾 حفظ الإعدادات وتطبيقها
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              نمط تسيير اللعب
            </label>
            <select
              value={formSettings.playMode}
              onChange={(e) =>
                setFormSettings({ ...formSettings, playMode: e.target.value as PlayMode })
              }
              className="form-input-token"
            >
              <option value="BOARD">لوحة الفئات التنافسية (دور بين الفرق)</option>
              <option value="AUTO_CATEGORY">تلقائي داخل الفئة المختارة</option>
              <option value="AUTO_ALL">تلقائي شامل لجميع الأسئلة</option>
              <option value="MANUAL">تحكم يدوي من المقدم</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              نمط الإجابة الافتراضي
            </label>
            <select
              value={formSettings.defaultAnswerMode}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  defaultAnswerMode: e.target.value as AnswerMode,
                })
              }
              className="form-input-token"
            >
              <option value="BUZZER">🔔 الضاغط الصوتي السريع</option>
              <option value="CHOICE">🔐 الإجابة السرية الجماعية (A/B/C)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              الخط العربي الموحد
            </label>
            <select
              value={formSettings.fontPair}
              onChange={(e) =>
                setFormSettings({ ...formSettings, fontPair: e.target.value as FontPairId })
              }
              className="form-input-token"
            >
              <option value="cairo-almarai">Cairo + Almarai (القياسي)</option>
              <option value="tajawal">Tajawal (التلفزيوني العريض)</option>
              <option value="ibm">IBM Plex Sans Arabic (التقني)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              عدد الفرق المشاركة (2 - 8)
            </label>
            <input
              type="number"
              min={2}
              max={8}
              value={formSettings.teamCount}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  teamCount: Math.min(8, Math.max(2, Number(e.target.value) || 4)),
                })
              }
              className="form-input-token"
            />
          </div>

          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              مؤقت عرض السؤال (بالثواني)
            </label>
            <input
              type="number"
              min={5}
              max={180}
              value={formSettings.timerSeconds}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  timerSeconds: Math.max(5, Number(e.target.value) || 25),
                })
              }
              className="form-input-token"
            />
          </div>

          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              مهلة إجابة الفريق بعد الضاغط (3 - 9ث)
            </label>
            <input
              type="number"
              min={3}
              max={9}
              value={formSettings.answerSeconds}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  answerSeconds: Math.min(9, Math.max(3, Number(e.target.value) || 7)),
                })
              }
              className="form-input-token"
            />
          </div>
        </div>

        {/* النقاط والجزاء */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-subtle-token pt-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              نقاط السهل
            </label>
            <input
              type="number"
              min={10}
              value={formSettings.pointsEasy}
              onChange={(e) =>
                setFormSettings({ ...formSettings, pointsEasy: Number(e.target.value) || 100 })
              }
              className="form-input-token"
            />
          </div>
          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              نقاط المتوسط
            </label>
            <input
              type="number"
              min={10}
              value={formSettings.pointsMedium}
              onChange={(e) =>
                setFormSettings({ ...formSettings, pointsMedium: Number(e.target.value) || 200 })
              }
              className="form-input-token"
            />
          </div>
          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              نقاط الصعب
            </label>
            <input
              type="number"
              min={10}
              value={formSettings.pointsHard}
              onChange={(e) =>
                setFormSettings({ ...formSettings, pointsHard: Number(e.target.value) || 300 })
              }
              className="form-input-token"
            />
          </div>
          <div>
            <label className="mb-1 block font-display text-xs font-black text-secondary-token">
              خصم الإجابة الخاطئة
            </label>
            <input
              type="number"
              min={0}
              value={formSettings.pointsWrongPenalty}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  pointsWrongPenalty: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="form-input-token"
            />
          </div>
        </div>

        {/* أسماء الفرق */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-subtle-token pt-4 sm:grid-cols-2 md:grid-cols-4">
          {teamIndices.map((idx) => {
            const key = `team${idx}Name` as keyof GameSettings;
            return (
              <div key={idx}>
                <label className="mb-1 block font-display text-xs font-black text-secondary-token">
                  اسم الفريق {idx}
                </label>
                <input
                  type="text"
                  value={String(formSettings[key])}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, [key]: e.target.value })
                  }
                  className="form-input-token"
                />
              </div>
            );
          })}
        </div>

        {/* الأدوات التكتيكية */}
        <div className="mt-4 border-t border-subtle-token pt-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-sm font-black text-primary-token">
              ⚡ تفعيل وأرصدة الأدوات التكتيكية الستة
            </span>
            <label className="flex cursor-pointer items-center gap-2 font-display text-xs font-black">
              <input
                type="checkbox"
                checked={formSettings.powerUpsEnabled}
                onChange={(e) =>
                  setFormSettings({ ...formSettings, powerUpsEnabled: e.target.checked })
                }
              />
              مفعّلة للفرق
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {(
              [
                ['puShieldCount', '🛡️ الدرع'],
                ['puAiCount', '✨ 50/50'],
                ['puDoubleCount', '🚀 ×2'],
                ['puFreezeCount', '❄️ تجميد'],
                ['puStealCount', '🧲 سرقة'],
                ['puTimeCount', '⏳ +15ث'],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <label className="mb-1 block text-xs font-bold text-secondary-token">{label}</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={formSettings[k]}
                  onChange={(e) =>
                    setFormSettings({
                      ...formSettings,
                      [k]: Math.min(10, Math.max(0, Number(e.target.value) || 0)),
                    })
                  }
                  className="form-input-token"
                />
              </div>
            ))}
          </div>
        </div>

        {/* حماية إظهار الإجابات للمذيع (PIN اختياري) */}
        <div className="mt-4 border-t border-subtle-token pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-display text-sm font-black text-primary-token">
                🔐 رمز حماية إجابات المذيع (PIN اختياري)
              </span>
              <p className="mt-0.5 text-xs font-bold text-secondary-token">
                الحالة الحالية:{' '}
                <span className={gameState.hostPinEnabled ? 'text-success-token' : 'text-accent-token'}>
                  {gameState.hostPinEnabled
                    ? 'مفعّل — يُطلب الرمز عند كشف الإجابات في صفحة المذيع'
                    : 'غير مفعّل — يظهر زر كشف الإجابات للمذيع مباشرة دون رمز'}
                </span>
              </p>
            </div>
            {gameState.hostPinEnabled && (
              <button
                type="button"
                onClick={() => void handleClearHostPin()}
                className="btn-token btn-token-sm btn-danger-token whitespace-nowrap shrink-0"
              >
                🔓 إزالة رمز الحماية
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <input
                type={showPinInput ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={16}
                placeholder={
                  gameState.hostPinEnabled
                    ? 'أدخل رمزاً جديداً لتغييره (أو اتركه فارغاً للإبقاء على الحالي)'
                    : 'أدخل رمزاً سرياً للمذيع (مثال: 1234) لتفعيل الحماية'
                }
                value={newHostPin}
                onChange={(e) => setNewHostPin(e.target.value)}
                className="form-input-token"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowPinInput((prev) => !prev)}
              className="btn-token btn-token-sm whitespace-nowrap shrink-0"
            >
              {showPinInput ? '🙈 إخفاء' : '👁️ عرض'}
            </button>
            <button
              type="button"
              disabled={!newHostPin.trim()}
              onClick={() => void handleSaveSettings()}
              className="btn-token btn-token-sm btn-primary-token whitespace-nowrap shrink-0"
            >
              🔒 حفظ الرمز وتطبيقه
            </button>
          </div>
        </div>
      </section>

      {/* 2. استوديو السمات البصرية الست والألوان الحية */}
      <section className="surface-card rounded-3xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-black text-primary-token">
              🎨 السمات البصرية الستة (النهاري الفاخر ومبدل السمات)
            </h2>
            <p className="text-xs font-bold text-secondary-token">
              التغيير ينعكس لحظياً على شاشة الجمهور وجميع أجهزة اللاعبين.
            </p>
          </div>
          <button type="button" onClick={() => void handleResetTokens()} className="btn-token btn-token-sm">
            🔄 استعادة ألوان السمة الأصلية
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEME_PRESETS.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => void handleThemeSelect(theme.id)}
              className={`theme-preset-card flex flex-col items-start rounded-2xl p-3.5 text-right ${
                gameState.activeTheme === theme.id ? 'is-selected' : ''
              }`}
            >
              <span className="font-display text-sm font-black">{theme.name}</span>
              <span className="mt-1 text-xs font-bold text-secondary-token">{theme.desc}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-subtle-token pt-4 sm:grid-cols-4">
          {CUSTOM_COLOR_TOKENS.map((item) => {
            const val = gameState.customTokens[item.key] || computedTokenHexes[item.key] || '';
            return (
              <label
                key={item.key}
                className="surface-canvas flex cursor-pointer items-center justify-between rounded-xl border border-subtle-token px-3 py-2"
              >
                <span className="font-display text-xs font-black">{item.label}</span>
                <input
                  type="color"
                  value={val}
                  onChange={(e) => void handleTokenColorChange(item.key, e.target.value)}
                  className="color-swatch-input"
                />
              </label>
            );
          })}
        </div>
      </section>

      {/* 3. استيراد Excel وإدارة بنك الأسئلة */}
      <section className="surface-card rounded-3xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-black text-primary-token">
              📊 استيراد ملفات Excel وإدارة بنك الأسئلة ({gameState.totalQuestionsCount} سؤال محفوظ)
            </h2>
            <p className="text-xs font-bold text-secondary-token">
              يدعم ملفات .xlsx و .xls و .csv (8 أعمدة أساسية، بالإضافة إلى 3 أعمدة اختيارية: رابط الصورة، رابط الصوت، معلومة إثرائية).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={downloadExcelTemplate} className="btn-token btn-token-sm">
              📥 تنزيل نموذج Excel جاهز
            </button>
            <label className="btn-token btn-token-sm btn-primary-token cursor-pointer">
              {importing ? '⏳ جاري الاستيراد...' : '📤 استيراد ملف Excel / CSV'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => void handleExcelUpload(e)}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => void onAction('LOAD_SAMPLE_QUESTIONS').then((r) => r.message && onToast(r.message))}
              className="btn-token btn-token-sm"
            >
              📚 استعادة 18 سؤالاً نموذجياً
            </button>
            <button
              type="button"
              onClick={() => void onAction('WIPE_QUESTIONS').then((r) => r.message && onToast(r.message))}
              className="btn-token btn-token-sm btn-danger-token"
            >
              🗑️ مسح كافة الأسئلة
            </button>
          </div>
        </div>

        {/* إضافة سؤال يدوي سريع */}
        <div className="surface-canvas rounded-2xl border border-subtle-token p-4">
          <h3 className="mb-3 font-display text-sm font-black text-primary-token">
            ➕ إضافة سؤال جديد يدوياً إلى قاعدة الخادم
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              type="text"
              placeholder="الجولة (مثال: الجولة 1)"
              value={newRound}
              onChange={(e) => setNewRound(e.target.value)}
              className="form-input-token"
            />
            <input
              type="text"
              placeholder="الفئة (مثال: علوم)"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="form-input-token"
            />
            <select
              value={newDifficulty}
              onChange={(e) => setNewDifficulty(e.target.value as DifficultyLevel)}
              className="form-input-token"
            >
              <option value="سهل">سهل</option>
              <option value="متوسط">متوسط</option>
              <option value="صعب">صعب</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="نص السؤال كاملاً..."
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            className="form-input-token mt-3"
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input
              type="text"
              placeholder="الخيار A"
              value={newOptA}
              onChange={(e) => setNewOptA(e.target.value)}
              className="form-input-token"
            />
            <input
              type="text"
              placeholder="الخيار B"
              value={newOptB}
              onChange={(e) => setNewOptB(e.target.value)}
              className="form-input-token"
            />
            <input
              type="text"
              placeholder="الخيار C"
              value={newOptC}
              onChange={(e) => setNewOptC(e.target.value)}
              className="form-input-token"
            />
            <select
              value={newCorrect}
              onChange={(e) => setNewCorrect(e.target.value as OptionLetter)}
              className="form-input-token"
            >
              <option value="A">الصحيح: A</option>
              <option value="B">الصحيح: B</option>
              <option value="C">الصحيح: C</option>
            </select>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="url"
              placeholder="رابط صورة السؤال (اختياري — https://...)"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              className="form-input-token"
            />
            <input
              type="url"
              placeholder="رابط مقطع صوتي (اختياري — MP3 / OGG)"
              value={newAudioUrl}
              onChange={(e) => setNewAudioUrl(e.target.value)}
              className="form-input-token"
            />
          </div>
          <input
            type="text"
            placeholder="معلومة إثرائية قصيرة تظهر للجمهور بعد كشف الإجابة (اختياري)..."
            value={newExplanation}
            onChange={(e) => setNewExplanation(e.target.value)}
            className="form-input-token mt-3"
          />
          <button
            type="button"
            onClick={() => void handleAddQuestion()}
            className="btn-token btn-success-token mt-3"
          >
            ✅ إضافة السؤال وحفظه بالخادم
          </button>
        </div>
      </section>
    </div>
  );
}
