#include "fsm.h"
#include "goodbye.h"
#include "base64.h"
#include "mic_convert.h"
#include "playback_drain.h"
#include "play_ring.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using crea_jarvis::logic::State;
using crea_jarvis::logic::VoiceFsm;

static int g_starts = 0;
static int g_acks = 0;
static int g_commits = 0;
static int g_ends = 0;

static void on_start(void *) { g_starts++; }
static void on_ack(void *) { g_acks++; }
static void on_commit(void *) { g_commits++; }
static void on_end(void *) { g_ends++; }

static void test_fsm_wake_ack_listen_commit() {
  g_starts = g_acks = g_commits = g_ends = 0;
  VoiceFsm fsm;
  fsm.cb.on_start_session = on_start;
  fsm.cb.on_ack_play = on_ack;
  fsm.cb.on_commit = on_commit;
  fsm.cb.on_end_session = on_end;

  fsm.on_wake(0.0f);
  assert(fsm.state == State::CONNECTING);
  assert(g_starts == 1);

  fsm.on_session_ready(0.1f);
  assert(fsm.state == State::ACK);
  assert(g_acks == 1);

  fsm.on_ack_finished(0.2f);
  assert(fsm.state == State::LISTENING);
  assert(fsm.stream_to_gateway());

  // speech then silence EOS (utterance >= 250ms, silence >= 700ms)
  fsm.on_capture_chunk(800.0f, 100.0f, 0.3f);
  fsm.on_capture_chunk(800.0f, 100.0f, 0.4f);
  fsm.on_capture_chunk(800.0f, 100.0f, 0.5f);  // 300ms speech
  for (int i = 0; i < 20; i++)  // 800ms silence
    fsm.on_capture_chunk(10.0f, 40.0f, 0.6f + i * 0.04f);
  assert(fsm.state == State::PROCESSING);
  assert(g_commits == 1);

  fsm.on_audio_delta(1.0f);
  assert(fsm.state == State::SPEAKING);
  fsm.on_playback_drained(1.1f);
  assert(fsm.state == State::ARMED);

  // armed → listening on speech without new session
  int starts_before = g_starts;
  fsm.on_capture_chunk(900.0f, 40.0f, 2.0f);
  assert(fsm.state == State::LISTENING);
  assert(g_starts == starts_before);

  // second wake while session open → cancel
  fsm.on_wake(2.1f);
  assert(fsm.state == State::IDLE);
  assert(g_ends == 1);
  assert(g_starts == starts_before);

  std::puts("test_fsm_wake_ack_listen_commit OK");
}

static void test_fsm_wake_cancels_open_session() {
  g_starts = g_acks = g_commits = g_ends = 0;
  VoiceFsm fsm;
  fsm.cb.on_start_session = on_start;
  fsm.cb.on_ack_play = on_ack;
  fsm.cb.on_end_session = on_end;

  fsm.on_wake(0.0f);
  assert(fsm.state == State::CONNECTING);
  assert(g_starts == 1);

  fsm.on_wake(0.05f);  // cancel during CONNECTING
  assert(fsm.state == State::IDLE);
  assert(g_ends == 1);

  fsm.on_wake(0.1f);
  fsm.on_session_ready(0.11f);
  assert(fsm.state == State::ACK);
  assert(g_acks == 1);
  fsm.on_wake(0.12f);  // cancel during ACK
  assert(fsm.state == State::IDLE);
  assert(g_ends == 2);

  fsm.on_wake(0.2f);
  fsm.on_session_ready(0.21f);
  fsm.on_ack_finished(0.22f);
  assert(fsm.state == State::LISTENING);
  fsm.on_wake(0.23f);  // cancel during LISTENING
  assert(fsm.state == State::IDLE);
  assert(g_ends == 3);

  fsm.state = State::ARMED;
  fsm.on_wake(1.0f);  // cancel while ARMED
  assert(fsm.state == State::IDLE);
  assert(g_ends == 4);

  std::puts("test_fsm_wake_cancels_open_session OK");
}

static void test_goodbye() {
  assert(crea_jarvis::logic::is_goodbye_utterance(u8"спасибо джарвис"));
  assert(crea_jarvis::logic::is_goodbye_utterance(u8"пока джарвис"));
  assert(crea_jarvis::logic::is_goodbye_utterance("bye jarvis"));
  assert(crea_jarvis::logic::is_goodbye_utterance("Спасибо Джарвис"));  // casefold
  assert(!crea_jarvis::logic::is_goodbye_utterance(
      u8"спасибо джарвис поставь таймер на 5 минут"));
  assert(!crea_jarvis::logic::is_goodbye_utterance(u8"какой сегодня день"));
  std::puts("test_goodbye OK");
}

static void test_base64() {
  const uint8_t raw[] = {0x00, 0x01, 0xff, 0x10};
  std::string enc = crea_jarvis::logic::base64_encode(raw, sizeof(raw));
  std::vector<uint8_t> dec;
  assert(crea_jarvis::logic::base64_decode(enc.c_str(), dec));
  assert(dec.size() == sizeof(raw));
  assert(std::memcmp(dec.data(), raw, sizeof(raw)) == 0);
  std::puts("test_base64 OK");
}

static void test_rms() {
  int16_t silent[8] = {0};
  assert(crea_jarvis::logic::rms_int16(silent, 8) == 0.0f);
  int16_t loud[2] = {1000, -1000};
  float r = crea_jarvis::logic::rms_int16(loud, 2);
  assert(r > 900.0f);
  std::puts("test_rms OK");
}

static void test_mic_convert() {
  // 4 stereo int32 frames @ 16 kHz → expect 6 pcm16 samples @ 24 kHz (4 * 1.5)
  int32_t frames[8];
  for (int i = 0; i < 4; i++) {
    frames[i * 2] = 1000 << 16;
    frames[i * 2 + 1] = 1000 << 16;
  }
  std::vector<int16_t> out;
  assert(crea_jarvis::logic::convert_voice_pe_mic_chunk(
      reinterpret_cast<const uint8_t *>(frames), sizeof(frames), &out));
  assert(out.size() == 6);
  for (int16_t s : out)
    assert(std::abs(static_cast<int>(s) - 1000) <= 2);

  // reject odd lengths
  assert(!crea_jarvis::logic::convert_voice_pe_mic_chunk(
      reinterpret_cast<const uint8_t *>(frames), 7, &out));

  // loud speech-like energy after convert clears RMS threshold
  for (int i = 0; i < 4; i++) {
    frames[i * 2] = 8000 << 16;
    frames[i * 2 + 1] = 8000 << 16;
  }
  assert(crea_jarvis::logic::convert_voice_pe_mic_chunk(
      reinterpret_cast<const uint8_t *>(frames), sizeof(frames), &out));
  float rms = crea_jarvis::logic::rms_int16(out.data(), out.size());
  assert(rms > 500.0f);

  std::puts("test_mic_convert OK");
}

static void test_playback_drain() {
  // Inter-chunk gap must NOT finish without response.done
  assert(!crea_jarvis::logic::playback_drain_ready(false, 1000, 100, 500));
  // response.done but speaker buffer still playing
  assert(!crea_jarvis::logic::playback_drain_ready(true, 500, 100, 800, 80));
  // response.done and past audio_end + grace
  assert(crea_jarvis::logic::playback_drain_ready(true, 900, 100, 800, 80));
  // 48KB PCM16 @ 24kHz = 1000ms
  assert(crea_jarvis::logic::pcm16_mono_duration_ms(48000, 24000) == 1000);
  std::puts("test_playback_drain OK");
}

static void test_play_ring() {
  uint8_t storage[16];
  crea_jarvis::logic::PlayRing ring;
  ring.buf = storage;
  ring.cap = sizeof(storage);
  ring.clear();

  uint8_t a[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
  assert(ring.write(a, 10) == 10);
  assert(ring.size() == 10);

  size_t n = 0;
  const uint8_t *p = ring.peek_contiguous(&n);
  assert(p && n == 10);
  assert(p[0] == 1 && p[9] == 10);
  ring.consume(6);
  assert(ring.size() == 4);

  // Wrap: free at front, write more than contiguous free at end
  uint8_t b[] = {11, 12, 13, 14, 15, 16, 17, 18};
  assert(ring.write(b, 8) == 8);  // 4 + 8 = 12, cap 16
  assert(ring.size() == 12);

  // Fill to capacity then partial write
  uint8_t c[] = {20, 21, 22, 23, 24, 25};
  assert(ring.write(c, 6) == 4);  // only 4 free
  assert(ring.free_space() == 0);

  ring.clear();
  assert(ring.empty());
  std::puts("test_play_ring OK");
}

int main() {
  test_fsm_wake_ack_listen_commit();
  test_fsm_wake_cancels_open_session();
  test_goodbye();
  test_base64();
  test_rms();
  test_mic_convert();
  test_playback_drain();
  test_play_ring();
  std::puts("ALL PASSED");
  return 0;
}
