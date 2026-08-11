#pragma once
/**
 * Contiguous PCM ring in caller-owned buffer (PSRAM on device).
 * Avoids per-chunk heap alloc and early dropouts from a short chunk queue.
 */
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace crea_jarvis {
namespace logic {

struct PlayRing {
  uint8_t *buf{nullptr};
  size_t cap{0};
  size_t head_{0};
  size_t tail_{0};
  size_t size_{0};

  bool empty() const { return size_ == 0; }
  size_t size() const { return size_; }
  size_t free_space() const { return cap - size_; }

  void clear() {
    head_ = 0;
    tail_ = 0;
    size_ = 0;
  }

  /** Append bytes; returns bytes actually written (may be < len if full). */
  size_t write(const uint8_t *data, size_t len) {
    if (!buf || !data || len == 0 || cap == 0)
      return 0;
    size_t to_write = std::min(len, free_space());
    size_t written = 0;
    while (written < to_write) {
      const size_t cont = cap - tail_;
      const size_t n = std::min(cont, to_write - written);
      memcpy(buf + tail_, data + written, n);
      tail_ = (tail_ + n) % cap;
      size_ += n;
      written += n;
    }
    return written;
  }

  /**
   * Contiguous readable span from head (does not wrap in one call).
   * Caller must consume(n) after feeding speaker.
   */
  const uint8_t *peek_contiguous(size_t *out_len) const {
    if (!buf || size_ == 0) {
      if (out_len)
        *out_len = 0;
      return nullptr;
    }
    const size_t cont = (head_ < tail_) ? (tail_ - head_) : (cap - head_);
    const size_t n = cont < size_ ? cont : size_;
    if (out_len)
      *out_len = n;
    return buf + head_;
  }

  void consume(size_t n) {
    if (n > size_)
      n = size_;
    head_ = (head_ + n) % cap;
    size_ -= n;
    if (size_ == 0) {
      head_ = 0;
      tail_ = 0;
    }
  }
};

}  // namespace logic
}  // namespace crea_jarvis
