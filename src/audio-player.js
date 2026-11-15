export function createAudioPlayer({ url, AudioCtor, volume = 0.35 } = {}) {
  if (typeof url !== 'string' || !url) throw new Error('Audio player requires a sound URL.');
  const Ctor = AudioCtor || globalThis.Audio;
  let audio = null;
  const getAudio = () => {
    if (typeof Ctor !== 'function') throw new Error('Audio playback is not supported in this context.');
    if (!audio) {
      audio = new Ctor(url);
      try { audio.volume = volume; } catch {}
    }
    return audio;
  };
  return async function play() {
    const el = getAudio();
    try { el.pause(); } catch {}
    try { el.currentTime = 0; } catch {}
    await el.play();
  };
}
