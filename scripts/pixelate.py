"""Turn Twemoji SVGs (CC-BY 4.0) into small palette-locked pixel sprites."""
import io, sys, cairosvg
from PIL import Image

# Endesga 32 palette
PAL = ["be4a2f","d77643","ead4aa","e4a672","b86f50","733e39","3e2731","a22633","e43b44","f77622","feae34","fee761","63c74d","3e8948","265c42","193c3e","124e89","0099db","2ce8f5","ffffff","c0cbdc","8b9bb4","5a6988","3a4466","262b44","181425","ff0044","68386c","b55088","f6757a","e8b796","c28569"]
PALRGB = [tuple(int(h[i:i+2],16) for i in (0,2,4)) for h in PAL]
OUTLINE = (24,20,37)
COLORS = 12

def nearest(c):
    r,g,b = c
    best=None;bd=1e9
    for p in PALRGB:
        # "redmean" perceptual distance
        rm = (r + p[0]) / 2
        d = (2 + rm/256)*(r-p[0])**2 + 4*(g-p[1])**2 + (2 + (255-rm)/256)*(b-p[2])**2
        if d<bd: bd=d;best=p
    return best

def pixelate(svg_path, size=32, outline=True, pad=1):
    inner = size - 2*pad
    png = cairosvg.svg2png(url=svg_path, output_width=inner*8, output_height=inner*8)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    # premultiplied box downsample
    small = im.resize((inner,inner), Image.BOX)
    out = Image.new("RGBA",(size,size),(0,0,0,0))
    px = small.load()
    for y in range(inner):
        for x in range(inner):
            r,g,b,a = px[x,y]
            if a < 110: continue
            # un-premultiply approx: BOX on RGBA in PIL is not premultiplied; ok
            out.putpixel((x+pad,y+pad), (r,g,b,255))
    # per-sprite colour reduction keeps hues but drops anti-aliasing blends
    rgb = out.convert("RGB").quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT).convert("RGB")
    alpha = out.getchannel("A")
    out = rgb.convert("RGBA"); out.putalpha(alpha)
    if outline:
        o = out.copy(); op = out.load()
        for y in range(size):
            for x in range(size):
                if op[x,y][3]: continue
                for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx,ny=x+dx,y+dy
                    if 0<=nx<size and 0<=ny<size and op[nx,ny][3]:
                        o.putpixel((x,y),OUTLINE+(255,)); break
        out = o
    return out

if __name__ == "__main__":
    src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
    pixelate(src, size).save(dst)
