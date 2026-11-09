// The shaper and FreeType share the original font bytes in one Wasm instance.
#include <hb.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MULTIPLE_MASTERS_H
#include FT_OUTLINE_H
#include <vector>

namespace {
struct OutlineFace {
  hb_blob_t *blob;
  FT_Face face = nullptr;
  std::vector<FT_Fixed> coordinates;

  explicit OutlineFace(hb_blob_t *source) : blob(source) {}

  ~OutlineFace() {
    if (face) FT_Done_Face(face);
    hb_blob_destroy(blob);
  }
};

void destroy_face(void *face) { delete static_cast<OutlineFace *>(face); }

OutlineFace *outline_face(hb_face_t *source) {
  static hb_user_data_key_t key;
  auto *cached = static_cast<OutlineFace *>(hb_face_get_user_data(source, &key));
  if (cached) return cached;
  static FT_Library library;
  if (!library && FT_Init_FreeType(&library)) return nullptr;
  auto *entry = new OutlineFace{hb_face_reference_blob(source)};
  unsigned length = 0;
  const auto *bytes = reinterpret_cast<const FT_Byte *>(hb_blob_get_data(entry->blob, &length));
  if (FT_New_Memory_Face(library, bytes, length, hb_face_get_index(source), &entry->face) ||
      !hb_face_set_user_data(source, &key, entry, destroy_face, false)) {
    delete entry;
    return nullptr;
  }
  return entry;
}

struct Pen {
  hb_draw_funcs_t *funcs;
  void *data;
  hb_draw_state_t state = HB_DRAW_STATE_DEFAULT;
  Pen(hb_draw_funcs_t *functions, void *target) : funcs(functions), data(target) {}
};
int move_to(const FT_Vector *p, void *user) {
  auto &pen = *static_cast<Pen *>(user);
  hb_draw_close_path(pen.funcs, pen.data, &pen.state);
  hb_draw_move_to(pen.funcs, pen.data, &pen.state, p->x / 64.f, p->y / 64.f);
  return 0;
}
int line_to(const FT_Vector *p, void *user) {
  auto &pen = *static_cast<Pen *>(user);
  hb_draw_line_to(pen.funcs, pen.data, &pen.state, p->x / 64.f, p->y / 64.f);
  return 0;
}
int quad_to(const FT_Vector *c, const FT_Vector *p, void *user) {
  auto &pen = *static_cast<Pen *>(user);
  hb_draw_quadratic_to(pen.funcs, pen.data, &pen.state, c->x / 64.f, c->y / 64.f, p->x / 64.f, p->y / 64.f);
  return 0;
}
int cubic_to(const FT_Vector *a, const FT_Vector *b, const FT_Vector *p, void *user) {
  auto &pen = *static_cast<Pen *>(user);
  hb_draw_cubic_to(pen.funcs, pen.data, &pen.state, a->x / 64.f, a->y / 64.f,
                   b->x / 64.f, b->y / 64.f, p->x / 64.f, p->y / 64.f);
  return 0;
}
} // namespace

extern "C" void figcraft_unhinted_outline(hb_font_t *font, unsigned glyph, hb_draw_funcs_t *funcs, void *data) {
  auto *entry = outline_face(hb_font_get_face(font));
  if (!entry) return;
  unsigned count = 0;
  const auto *normal = hb_font_get_var_coords_normalized(font, &count);
  bool changed = count != entry->coordinates.size();
  for (unsigned i = 0; i < count && !changed; ++i) changed = entry->coordinates[i] != normal[i] * 4;
  if (changed) {
    std::vector<FT_Fixed> blend(count);
    for (unsigned i = 0; i < count; ++i) blend[i] = normal[i] * 4;
    if (FT_Set_Var_Blend_Coordinates(entry->face, count, blend.data()) > 0) return;
    entry->coordinates.swap(blend);
  }
  if (FT_Load_Glyph(entry->face, glyph, FT_LOAD_NO_SCALE | FT_LOAD_NO_HINTING | FT_LOAD_NO_BITMAP)) return;
  auto &slot = *entry->face->glyph;
  if (slot.format != FT_GLYPH_FORMAT_OUTLINE) return;
  // Keep half-unit implied quadratic midpoints when FreeType decomposes unscaled points.
  const FT_Outline_Funcs callbacks = {move_to, line_to, quad_to, cubic_to, 6, 0};
  Pen pen{funcs, data};
  if (!FT_Outline_Decompose(&slot.outline, &callbacks, &pen)) hb_draw_close_path(funcs, data, &pen.state);
}
