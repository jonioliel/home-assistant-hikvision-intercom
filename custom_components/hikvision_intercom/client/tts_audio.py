"""Strict conversion from Home Assistant TTS WAV to Hikvision G.711 mu-law."""

from __future__ import annotations

import io
import struct
import wave

from .audio import PACKET_BYTES

MAX_AUDIO_SECONDS = 60
SILENCE = 0xFF


class TtsCodecError(Exception):
    """A bounded, provider-independent TTS audio validation error."""

    def __init__(self, code: str) -> None:
        super().__init__("TTS audio is not compatible")
        self.code = code


def encode_mulaw_sample(sample: int) -> int:
    """Encode one signed 16-bit PCM sample as ITU G.711 mu-law."""

    sample = max(-32768, min(32767, sample))
    sign = 0x80 if sample < 0 else 0
    if sign:
        sample = -sample
    sample = min(32635, sample) + 132
    exponent = 7
    mask = 0x4000
    while exponent > 0 and not sample & mask:
        exponent -= 1
        mask >>= 1
    return ~(sign | (exponent << 4) | ((sample >> (exponent + 3)) & 0x0F)) & 0xFF


def wav_to_mulaw_packets(data: bytes) -> tuple[list[bytes], float]:
    """Validate HA's preferred WAV result and return bounded 100 ms packets."""

    try:
        with wave.open(io.BytesIO(data), "rb") as source:
            if (
                source.getnchannels() != 1
                or source.getframerate() != 8000
                or source.getsampwidth() != 2
                or source.getcomptype() != "NONE"
            ):
                raise TtsCodecError("tts_audio_format")
            declared_frames = source.getnframes()
            if declared_frames <= 0:
                raise TtsCodecError("tts_audio_too_long")
            # Some HA TTS providers return a streaming WAV whose data chunk is
            # deliberately advertised as 0xffffffff. ``wave`` consequently
            # reports billions of frames even though the bounded response body
            # contains only a short announcement. Read at most one frame over
            # our limit and validate the bytes that actually arrived instead of
            # trusting the streaming sentinel.
            pcm = source.readframes(MAX_AUDIO_SECONDS * 8000 + 1)
            if len(pcm) % 2:
                raise TtsCodecError("tts_audio_format")
            frame_count = len(pcm) // 2
            if frame_count <= 0 or frame_count > MAX_AUDIO_SECONDS * 8000:
                raise TtsCodecError("tts_audio_too_long")
            if declared_frames <= MAX_AUDIO_SECONDS * 8000 and frame_count != declared_frames:
                raise TtsCodecError("tts_audio_format")
    except TtsCodecError:
        raise
    except (EOFError, wave.Error):
        raise TtsCodecError("tts_audio_format") from None

    encoded = bytes(encode_mulaw_sample(sample[0]) for sample in struct.iter_unpack("<h", pcm))
    if remainder := len(encoded) % PACKET_BYTES:
        encoded += bytes([SILENCE]) * (PACKET_BYTES - remainder)
    return [
        encoded[offset : offset + PACKET_BYTES] for offset in range(0, len(encoded), PACKET_BYTES)
    ], frame_count / 8000
