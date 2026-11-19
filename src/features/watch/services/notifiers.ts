import { spawn } from 'node:child_process';
import { Notifier, WatchAlert, WatchLang } from '../domain/watch_types.js';

/** Runs a program without a shell and waits for it; never rejects (resolves false on any failure). */
export type QuietSpawn = (cmd: string, args: string[], env?: Record<string, string>) => Promise<boolean>;

export const quietSpawn: QuietSpawn = (cmd, args, env) =>
  new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } });
      const timer = setTimeout(() => child.kill(), 30_000);
      child.on('error', () => (clearTimeout(timer), resolve(false)));
      child.on('exit', (code) => (clearTimeout(timer), resolve(code === 0)));
    } catch {
      resolve(false);
    }
  });

const POWERSHELL = 'powershell.exe';
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

// Text always travels in environment variables, never inside the script: nothing the
// alert contains (file names, compiler messages) can be interpreted as code.
const WINDOWS_TOAST = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
  '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  '$n = $t.GetElementsByTagName("text")',
  '$n.Item(0).AppendChild($t.CreateTextNode($env:HX_TITLE)) > $null',
  '$n.Item(1).AppendChild($t.CreateTextNode($env:HX_BODY)) > $null',
  '$app = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($t))',
].join('; ');

const WINDOWS_SPEECH = [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ($env:HX_LANG + "*") } | Select-Object -First 1',
  'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }',
  '$s.Speak($env:HX_TEXT)',
].join('; ');

const MAC_NOTIFY = ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run'];

/** Writes every alert (important or not) to the terminal. */
export class ConsoleNotifier implements Notifier {
  readonly name = 'console';
  readonly verbose = true;
  constructor(private readonly write: (line: string) => void = (l) => console.error(l)) {}
  async notify(alert: WatchAlert): Promise<void> {
    this.write(`${alert.title}${alert.body ? ` — ${alert.body}` : ''}`);
  }
}

/** System notification: Windows toast, macOS Notification Center, notify-send on Linux. */
export class DesktopNotifier implements Notifier {
  readonly name = 'desktop';
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: QuietSpawn = quietSpawn
  ) {}

  async notify(alert: WatchAlert): Promise<void> {
    const ok =
      this.platform === 'win32'
        ? await this.run(POWERSHELL, [...PS_ARGS, WINDOWS_TOAST], { HX_TITLE: alert.title, HX_BODY: alert.body })
        : this.platform === 'darwin'
          ? await this.run('osascript', [...MAC_NOTIFY, alert.title, alert.body])
          : await this.run('notify-send', [alert.title, alert.body]);
    if (!ok) throw new Error('the system notification could not be shown');
  }
}

/** Reads important alerts aloud, one at a time (Windows SAPI, macOS say, Linux spd-say). */
export class SpeechNotifier implements Notifier {
  readonly name = 'voice';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly lang: WatchLang,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: QuietSpawn = quietSpawn
  ) {}

  notify(alert: WatchAlert): Promise<void> {
    if (!alert.spoken) return Promise.resolve();
    const next = this.queue.then(() => this.say(alert.spoken));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Also used by the voice slice later on to answer the user. */
  async say(text: string): Promise<void> {
    const ok =
      this.platform === 'win32'
        ? await this.run(POWERSHELL, [...PS_ARGS, WINDOWS_SPEECH], { HX_TEXT: text, HX_LANG: this.lang })
        : this.platform === 'darwin'
          ? await this.run('say', [text])
          : await this.run('spd-say', ['-w', '-l', this.lang, text]);
    if (!ok) throw new Error('text-to-speech is not available on this system');
  }
}

export type NotifierName = 'console' | 'desktop' | 'voice';
export const NOTIFIER_NAMES: readonly NotifierName[] = ['console', 'desktop', 'voice'];

export function createNotifiers(names: readonly NotifierName[], lang: WatchLang, write?: (line: string) => void): Notifier[] {
  return names.map((n) => (n === 'console' ? new ConsoleNotifier(write) : n === 'desktop' ? new DesktopNotifier() : new SpeechNotifier(lang)));
}
