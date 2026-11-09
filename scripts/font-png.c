#define WUFFS_IMPLEMENTATION
#define WUFFS_CONFIG__MODULES
#define WUFFS_CONFIG__MODULE__BASE
#define WUFFS_CONFIG__MODULE__ADLER32
#define WUFFS_CONFIG__MODULE__CRC32
#define WUFFS_CONFIG__MODULE__DEFLATE
#define WUFFS_CONFIG__MODULE__ZLIB
#define WUFFS_CONFIG__MODULE__PNG
#define WUFFS_CONFIG__DST_PIXEL_FORMAT__ENABLE_ALLOWLIST
#define WUFFS_CONFIG__DST_PIXEL_FORMAT__ALLOW_RGBA_NONPREMUL
#include "wuffs.c"

// Decode only the first PNG frame and ignore colour-profile metadata. The caller
// checks the header dimensions before reserving its RGBA destination.
int figcraft_decode_font_png(uint8_t *bytes,size_t length,uint32_t width,uint32_t height,uint8_t *rgba) {
  if (!rgba || !bytes || !width || !height || width>1024 || height>1024) return 0;
  wuffs_png__decoder *decoder=wuffs_png__decoder__alloc();
  if (!decoder) return 0;
  wuffs_base__io_buffer src=wuffs_base__ptr_u8__reader(bytes,length,true);
  wuffs_base__image_config ic={0};
  int ok=0;
  uint8_t *work=NULL;
  if (wuffs_png__decoder__decode_image_config(decoder,&ic,&src).repr ||
      wuffs_base__pixel_config__width(&ic.pixcfg)!=width || wuffs_base__pixel_config__height(&ic.pixcfg)!=height) goto done;
  wuffs_base__pixel_config cfg={0};
  wuffs_base__pixel_config__set(&cfg,WUFFS_BASE__PIXEL_FORMAT__RGBA_NONPREMUL,0,width,height);
  wuffs_base__pixel_buffer pb={0};
  if (wuffs_base__pixel_buffer__set_from_slice(&pb,&cfg,wuffs_base__make_slice_u8(rgba,(size_t)width*height*4)).repr) goto done;
  size_t work_len=wuffs_png__decoder__workbuf_len(decoder).max_incl;
  if (work_len>32*1024*1024) goto done;
  if (work_len && !(work=malloc(work_len))) goto done;
  ok=!wuffs_png__decoder__decode_frame(decoder,&pb,&src,WUFFS_BASE__PIXEL_BLEND__SRC,wuffs_base__make_slice_u8(work,work_len),NULL).repr;
done:
  free(work); free(decoder); return ok;
}
