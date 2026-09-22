from __future__ import annotations

import io
import math
import struct
import wave

import pytest

from custom_components.hikvision_intercom.client.tts_audio import (
    MAX_AUDIO_SECONDS,
    TtsCodecError,
    encode_mulaw_sample,
    wav_to_mulaw_packets,
)


def wav(samples: list[int], *, rate: int = 8000, channels: int = 1, width: int = 2) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(width)
        target.setframerate(rate)
        if width == 2:
            target.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))
        else:
            target.writeframes(bytes(128 for _sample in samples))
    return output.getvalue()


def test_tts_wav_converts_to_exact_device_packets_with_silence_padding():
    samples = [0] * 800 + [12000]
    packets, duration = wav_to_mulaw_packets(wav(samples))
    assert len(packets) == 2
    assert all(len(packet) == 800 for packet in packets)
    assert packets[0] == b"\xff" * 800
    assert packets[1][0] != 0xFF
    assert packets[1][1:] == b"\xff" * 799
    assert duration == pytest.approx(801 / 8000)


def test_mulaw_encoder_preserves_sign_and_clamps_input():
    assert encode_mulaw_sample(0) == 0xFF
    assert encode_mulaw_sample(12000) != encode_mulaw_sample(-12000)
    assert encode_mulaw_sample(99999) == encode_mulaw_sample(32767)
    assert encode_mulaw_sample(-99999) == encode_mulaw_sample(-32768)


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (b"not-a-wave", "tts_audio_format"),
        (wav([0] * 80, rate=16000), "tts_audio_format"),
        (wav([0] * 80, channels=2), "tts_audio_format"),
        (wav([0] * 80, width=1), "tts_audio_format"),
        (wav([], rate=8000), "tts_audio_too_long"),
    ],
)
def test_tts_wav_rejects_unexpected_or_empty_audio(payload, code):
    with pytest.raises(TtsCodecError, match="TTS audio") as raised:
        wav_to_mulaw_packets(payload)
    assert raised.value.code == code


def test_tts_wav_rejects_more_than_one_minute():
    sample_count = MAX_AUDIO_SECONDS * 8000 + 1
    tone = [round(math.sin(index / 20) * 1000) for index in range(sample_count)]
    with pytest.raises(TtsCodecError) as raised:
        wav_to_mulaw_packets(wav(tone))
    assert raised.value.code == "tts_audio_too_long"
