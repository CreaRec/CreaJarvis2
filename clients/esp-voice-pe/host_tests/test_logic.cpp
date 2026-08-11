#include "fsm.h"
#include "goodbye.h"
#include "base64.h"

#include <cassert>
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

int main() {
  test_fsm_wake_ack_listen_commit();
  test_fsm_wake_cancels_open_session();
  test_goodbye();
  test_base64();
  test_rms();
  std::puts("ALL PASSED");
  return 0;
}
