#pragma once
/**
 * Goodbye phrase detection — mirrors clients/desktop/jarvis_client/goodbye.py
 */
#include <cctype>
#include <cstring>
#include <string>

namespace crea_jarvis {
namespace logic {

inline void utf8_append_lower_cyrillic(std::string &out, unsigned char b0,
                                       unsigned char b1) {
  // Upper А-П (D0 90-9F) → а-п (D0 B0-BF)
  if (b0 == 0xD0 && b1 >= 0x90 && b1 <= 0x9F) {
    out.push_back(static_cast<char>(0xD0));
    out.push_back(static_cast<char>(b1 + 0x20));
    return;
  }
  // Upper Р-Я (D0 A0-AF) → р-я (D1 80-8F)
  if (b0 == 0xD0 && b1 >= 0xA0 && b1 <= 0xAF) {
    out.push_back(static_cast<char>(0xD1));
    out.push_back(static_cast<char>(b1 - 0x20));
    return;
  }
  // Ё (D0 81) / ё (D1 91) → е
  if ((b0 == 0xD0 && b1 == 0x81) || (b0 == 0xD1 && b1 == 0x91)) {
    out.push_back(static_cast<char>(0xD0));
    out.push_back(static_cast<char>(0xB5));  // е
    return;
  }
  out.push_back(static_cast<char>(b0));
  out.push_back(static_cast<char>(b1));
}

inline void normalize_utterance(const char *text, std::string &out) {
  out.clear();
  if (!text)
    return;
  bool space = false;
  const unsigned char *p = reinterpret_cast<const unsigned char *>(text);
  while (*p) {
    if ((*p & 0x80) == 0) {
      unsigned char c = *p++;
      if (std::isalnum(c)) {
        if (space && !out.empty())
          out.push_back(' ');
        space = false;
        out.push_back(static_cast<char>(std::tolower(c)));
      } else if (std::isspace(c)) {
        space = true;
      } else {
        space = true;
      }
      continue;
    }
    // UTF-8 2-byte (Cyrillic)
    if ((*p & 0xE0) == 0xC0 && p[1]) {
      if (space && !out.empty())
        out.push_back(' ');
      space = false;
      utf8_append_lower_cyrillic(out, p[0], p[1]);
      p += 2;
      continue;
    }
    // Skip longer UTF-8 sequences as space separators
    if ((*p & 0xF0) == 0xE0 && p[1] && p[2]) {
      space = true;
      p += 3;
      continue;
    }
    if ((*p & 0xF8) == 0xF0 && p[1] && p[2] && p[3]) {
      space = true;
      p += 4;
      continue;
    }
    ++p;
  }
  while (!out.empty() && out.back() == ' ')
    out.pop_back();
}

inline bool is_exact_goodbye(const std::string &n) {
  static const char *kExact[] = {
      "пока",
      "все",
      "до свидания",
      "давай до свидания",
      "давай пока",
      "спасибо джарвис",
      "спасибо джарвис спасибо",
      "благодарю джарвис",
      "пока джарвис",
      "до свидания джарвис",
      "все джарвис",
      "на этом все джарвис",
      "джарвис спасибо",
      "джарвис пока",
      "джарвис все",
      "джарвис до свидания",
      "thank you jarvis",
      "thanks jarvis",
      "bye jarvis",
      "goodbye jarvis",
      "jarvis thanks",
      "jarvis bye",
      nullptr,
  };
  for (int i = 0; kExact[i]; i++) {
    if (n == kExact[i])
      return true;
  }
  return false;
}

inline bool short_name_plus_farewell(const std::string &n) {
  size_t sp = n.find(' ');
  if (sp == std::string::npos)
    return false;
  std::string first = n.substr(0, sp);
  std::string rest = n.substr(sp + 1);
  if (rest == "пока" && first.size() >= 1 && first.size() <= 20)
    return true;
  if (rest == "до свидания" && first.size() >= 1 && first.size() <= 12)
    return true;
  return false;
}

inline bool filler_or_short(const std::string &rest) {
  if (rest.empty() || rest == "пожалуйста" || rest == "все" ||
      rest == "ладно" || rest == "ок" || rest == "окей")
    return true;
  size_t spaces = 0;
  for (char c : rest)
    if (c == ' ')
      spaces++;
  return spaces == 0 && rest.size() <= 12;
}

inline bool is_goodbye_utterance(const char *text) {
  std::string n;
  normalize_utterance(text, n);
  if (n.empty())
    return false;
  if (is_exact_goodbye(n))
    return true;
  if (short_name_plus_farewell(n))
    return true;
  static const char *kPrefix[] = {
      "спасибо джарвис",
      "благодарю джарвис",
      "пока джарвис",
      "до свидания джарвис",
      "все джарвис",
      "на этом все джарвис",
      "давай до свидания",
      "до свидания",
      "thank you jarvis",
      "thanks jarvis",
      "bye jarvis",
      "goodbye jarvis",
      nullptr,
  };
  for (int i = 0; kPrefix[i]; i++) {
    const char *pref = kPrefix[i];
    size_t plen = std::strlen(pref);
    if (n == pref)
      return true;
    if (n.size() > plen && n.compare(0, plen, pref) == 0 && n[plen] == ' ') {
      if (filler_or_short(n.substr(plen + 1)))
        return true;
    }
  }
  return false;
}

}  // namespace logic
}  // namespace crea_jarvis
