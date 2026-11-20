import type { GameState } from '../types/game';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private soundEnabled = true;

  private ensureContext(): AudioContext | null {
    if (!this.soundEnabled) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  public isEnabled(): boolean {
    return this.soundEnabled;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.2): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  public playBuzzer(): void {
    this.playTone(620, 0.14, 'sawtooth', 0.22);
    setTimeout(() => this.playTone(880, 0.22, 'triangle', 0.22), 90);
  }

  public playCorrect(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.22, 'triangle', 0.18), idx * 80);
    });
  }

  public playWrong(): void {
    this.playTone(230, 0.24, 'sawtooth', 0.2);
    setTimeout(() => this.playTone(170, 0.3, 'sawtooth', 0.2), 140);
  }

  public playReveal(): void {
    [440, 587.33, 880].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.2, 'sine', 0.16), idx * 75);
    });
  }

  public playVictory(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.28, 'triangle', 0.2), idx * 100);
    });
  }

  public playTick(urgent = false): void {
    if (urgent) {
      this.playTone(1240, 0.08, 'triangle', 0.16);
      setTimeout(() => this.playTone(980, 0.06, 'sine', 0.12), 110);
    } else {
      this.playTone(880, 0.07, 'sine', 0.12);
    }
  }

  public playMystery(isBad = false): void {
    if (isBad) {
      [440, 392, 311.13, 220].forEach((freq, idx) => {
        setTimeout(() => this.playTone(freq, 0.22, 'sawtooth', 0.17), idx * 80);
      });
      return;
    }
    [587.33, 739.99, 880, 1174.66].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.18, 'triangle', 0.18), idx * 70);
    });
  }

  public playTrapDetonate(): void {
    this.playTone(185, 0.26, 'sawtooth', 0.24);
    setTimeout(() => this.playTone(130, 0.34, 'square', 0.22), 110);
    setTimeout(() => this.playTone(92, 0.38, 'sawtooth', 0.2), 230);
  }

  public playDuelBell(): void {
    this.playTone(784, 0.24, 'triangle', 0.22);
    setTimeout(() => this.playTone(1046.5, 0.36, 'triangle', 0.22), 160);
  }

  public playBombToss(): void {
    [520, 680, 860, 1100].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.1, 'square', 0.16), idx * 65);
    });
  }

  public playBountyClaim(): void {
    [659.25, 880, 1174.66, 1567.98].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.22, 'triangle', 0.2), idx * 70);
    });
  }

  public playWagerLock(): void {
    this.playTone(523.25, 0.1, 'sine', 0.15);
    setTimeout(() => this.playTone(783.99, 0.16, 'triangle', 0.16), 75);
  }

  public playFinalReveal(): void {
    [392.0, 493.88, 587.33, 783.99, 987.77].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.3, 'triangle', 0.18), idx * 85);
    });
  }

  public handleStateTransition(prev: GameState | null, next: GameState): void {
    if (!prev) return;

    if (prev.questionInstanceId !== next.questionInstanceId) {
      if (next.activeTrapTrigger?.status === 'DETONATED') {
        this.playTrapDetonate();
      } else if (next.activeDuel) {
        this.playDuelBell();
      } else if (next.activeMysteryTwist) {
        this.playMystery(next.activeMysteryTwist.sentiment === 'BAD');
      }
    }

    if (
      next.activeBomb?.status === 'TICKING' &&
      prev.activeBomb?.status !== 'TICKING'
    ) {
      this.playBombToss();
    }

    if (
      next.lastBountyClaim &&
      next.lastBountyClaim.at !== prev.lastBountyClaim?.at
    ) {
      this.playBountyClaim();
    }

    if (prev.fsmState === next.fsmState) return;
    if (next.fsmState === 'BUZZER_LOCKED') {
      if (next.activeBomb?.status !== 'TICKING') {
        this.playBuzzer();
      }
    } else if (next.fsmState === 'ANSWER_CORRECT') {
      this.playCorrect();
    } else if (next.fsmState === 'ANSWER_WRONG' || next.fsmState === 'ANSWER_TIMEOUT') {
      this.playWrong();
    } else if (next.fsmState === 'CHOICE_REVEALED' || next.fsmState === 'FINAL_WAGER_OPEN' || next.fsmState === 'TRAP_SETUP') {
      this.playReveal();
    } else if (next.fsmState === 'FINAL_REVEALED') {
      this.playFinalReveal();
    } else if (next.fsmState === 'CELEBRATION_PODIUM') {
      this.playVictory();
    }
  }

  public close(): void {
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export const soundEngine = new SoundEngine();
