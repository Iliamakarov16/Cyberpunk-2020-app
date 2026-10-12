// Short synthesized gunshot, started only from an explicit UI action.
export class BattleAudio {
    constructor() { this.context = null; }
    async enable() {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if(!Audio)return;
        try {if(!this.context || this.context.state === 'closed')this.context = new Audio();if(this.context.state === 'suspended')await this.context.resume();}catch{}
    }
    async shot() {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio)
            return;
        try {
            if (!this.context || this.context.state === 'closed')
                this.context = new Audio();
            const c = this.context;
            if (c.state === 'suspended')
                await c.resume();
            const start = c.currentTime, buffer = c.createBuffer(1, Math.ceil(c.sampleRate * .16), c.sampleRate), data = buffer.getChannelData(0);
            let seed = 123456789;
            for (let i = 0; i < data.length; i++) {
                seed = (1664525 * seed + 1013904223) >>> 0;
                data[i] = (seed / 4294967296 * 2 - 1) * Math.exp(-i / (c.sampleRate * .028));
            }
            const noise = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
            noise.buffer = buffer;
            filter.type = 'highpass';
            filter.frequency.value = 650;
            gain.gain.setValueAtTime(.12, start);
            gain.gain.exponentialRampToValueAtTime(.001, start + .16);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(c.destination);
            noise.start(start);
            noise.stop(start + .17);
            const low = c.createOscillator(), body = c.createGain();
            low.frequency.setValueAtTime(140, start);
            low.frequency.exponentialRampToValueAtTime(48, start + .13);
            body.gain.setValueAtTime(.075, start);
            body.gain.exponentialRampToValueAtTime(.001, start + .18);
            low.connect(body);
            body.connect(c.destination);
            low.start(start);
            low.stop(start + .19);
        }
        catch { /* Audio is optional; an unavailable audio device never rejects a game command. */ }
    }
    dispose() { if (this.context) {
        this.context.close().catch(() => { });
        this.context = null;
    } }
}
