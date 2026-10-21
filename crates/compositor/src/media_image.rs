//! Image sprites and software-decoded video overlays share one RGBA upload path.
use anyhow::{bail, Result};
use std::{cell::RefCell, collections::HashMap, ptr};
use crate::ffi::{sws_getContext, sws_scale, sws_freeContext, AVPixelFormat};
use crate::linux_decode::SwDecoder;

const VIDEO_PREFIX: &str = "rs-video-frame:";
struct VideoCache { decoder: SwDecoder, frame: Option<(u32, image::RgbaImage)> }
thread_local! { static VIDEOS: RefCell<HashMap<String, VideoCache>> = RefCell::new(HashMap::new()); }

pub fn video_source(path: &str, time: f64) -> String {
    format!("{VIDEO_PREFIX}{}", serde_json::json!([path, time.max(0.0)]))
}

pub fn load(path: &str) -> Result<image::RgbaImage> {
    if let Some(image) = crate::creative::load(path) { return image; }
    if let Some(request) = path.strip_prefix(VIDEO_PREFIX) {
        let (path, time): (String, f64) = serde_json::from_str(request)?;
        return VIDEOS.with(|videos| -> Result<image::RgbaImage> {
            let mut videos = videos.borrow_mut();
            if !videos.contains_key(&path) {
                // Bound decoder memory; eviction changes performance, never authored output.
                if videos.len() >= 8 { videos.clear(); }
                videos.insert(path.clone(), VideoCache { decoder: SwDecoder::open(&path)?, frame: None });
            }
            let cache = videos.get_mut(&path).expect("inserted decoder");
            let fps = cache.decoder.fps().max(1.0);
            let time = time.min(cache.decoder.duration_sec().map(|d| (d - 1.0 / fps).max(0.0)).unwrap_or(time));
            let index = (time * fps).floor().max(0.0) as u32;
            if let Some((previous, image)) = &cache.frame { if *previous == index { return Ok(image.clone()); } }
            let image = unsafe {
                let frame = cache.decoder.decode_at(index)?;
                let result = rgba_frame(frame);
                SwDecoder::free_frame(frame);
                result?
            };
            cache.frame = Some((index, image.clone()));
            Ok(image)
        });
    }
    if let Some(bytes) = crate::frame_geometry::decode_data_uri(path) {
        Ok(image::load_from_memory(&bytes)?.to_rgba8())
    } else { Ok(image::open(path)?.to_rgba8()) }
}

unsafe fn rgba_frame(frame: *mut crate::ffi::AVFrame) -> Result<image::RgbaImage> {
    let (w, h) = ((*frame).width, (*frame).height);
    if w <= 0 || h <= 0 { bail!("Invalid overlay dimensions"); }
    let context = sws_getContext(w, h, (*frame).format as AVPixelFormat::Type, w, h,
        AVPixelFormat::AV_PIX_FMT_RGBA, 2, ptr::null_mut(), ptr::null_mut(), ptr::null());
    if context.is_null() { bail!("Could not convert overlay frame"); }
    let mut image = image::RgbaImage::new(w as u32, h as u32);
    // FFmpeg SIMD conversion can write padding beyond the last pixel.
    let stride = (w as usize * 4 + 31) & !31;
    let mut pixels = vec![0u8; stride * h as usize + 64];
    let mut output = [pixels.as_mut_ptr(), ptr::null_mut(), ptr::null_mut(), ptr::null_mut()];
    let strides = [stride as i32, 0, 0, 0];
    let rows = sws_scale(context, (*frame).data.as_ptr() as *const *const u8,
        (*frame).linesize.as_ptr(), 0, h, output.as_mut_ptr(), strides.as_ptr());
    sws_freeContext(context);
    if rows != h { bail!("Incomplete overlay frame conversion"); }
    for row in 0..h as usize {
        let width = w as usize * 4;
        image.as_mut()[row * width..(row + 1) * width]
            .copy_from_slice(&pixels[row * stride..row * stride + width]);
    }
    Ok(image)
}

/// Resolution-independent motion, reused by clips and image/video annotations.
pub fn animated_rect(rect: [f32; 4], animation: Option<&str>, elapsed: f32, height: f32) -> ([f32; 4], f32) {
    let state = crate::text_anim::text_animation_state(animation, elapsed.max(0.0) * 1000.0, f32::MAX);
    let [x,y,w,h] = rect;
    let dx = state.translate_x * height / crate::text_anim::ANIMATION_REFERENCE_HEIGHT;
    let dy = state.translate_y * height / crate::text_anim::ANIMATION_REFERENCE_HEIGHT;
    ([x + (w - w * state.scale) * 0.5 + dx, y + (h - h * state.scale) * 0.5 + dy, w * state.scale, h * state.scale], state.opacity)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_decoder_seeks_and_holds_the_last_frame() {
        let available = std::process::Command::new("ffmpeg").arg("-version").output().is_ok();
        if !available {
            assert!(std::env::var("REACTION_STATION_MEDIA_TESTS").as_deref() != Ok("1"), "CI must provide FFmpeg");
            return;
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let file = std::env::temp_dir().join(format!("reaction-overlay-{}-{stamp}.mkv", std::process::id()));
        let encoded = std::process::Command::new("ffmpeg").args([
            "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=34x24:r=30:d=0.5",
            "-f", "lavfi", "-i", "color=c=blue:s=34x24:r=30:d=0.5",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "ffv1", "-threads", "1",
        ]).arg(&file).output().unwrap();
        assert!(encoded.status.success(), "{}", String::from_utf8_lossy(&encoded.stderr));
        let path = file.to_string_lossy();
        let red = load(&video_source(&path, 0.0)).unwrap();
        let blue = load(&video_source(&path, 0.75)).unwrap();
        let held = load(&video_source(&path, 50.0)).unwrap();
        let again = load(&video_source(&path, 0.0)).unwrap();
        VIDEOS.with(|cache| cache.borrow_mut().remove(path.as_ref()));
        std::fs::remove_file(&file).unwrap();
        assert_eq!(red.dimensions(), (34, 24));
        assert!(red.get_pixel(10, 10)[0] > 200);
        assert!(blue.get_pixel(10, 10)[2] > 200);
        assert_eq!(held, blue);
        assert_eq!(again, red);
    }
    #[test]
    fn creative_source_keeps_a_nonzero_clock_without_padding() {
        if std::process::Command::new("ffmpeg").arg("-version").output().is_err() {
            assert!(std::env::var("REACTION_STATION_MEDIA_TESTS").as_deref() != Ok("1"), "CI must provide FFmpeg");
            return;
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let file = std::env::temp_dir().join(format!("reaction-creative-clock-{}-{stamp}.mp4", std::process::id()));
        let encoded = std::process::Command::new("ffmpeg").args([
            "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=32x24:r=10:d=1",
            "-c:v", "mpeg4", "-output_ts_offset", "5",
        ]).arg(&file).output().unwrap();
        assert!(encoded.status.success(), "{}", String::from_utf8_lossy(&encoded.stderr));
        let path = file.to_string_lossy();
        {
            let decoder = SwDecoder::open(&path).unwrap();
            assert!((decoder.duration_sec().unwrap() - 6.0).abs() < 0.01);
            assert!((decoder.fps() - 10.0).abs() < 0.01);
        }
        let frame = load(&video_source(&path, 5.5)).unwrap();
        assert!(frame.get_pixel(10, 10)[0] > 200);
        VIDEOS.with(|cache| cache.borrow_mut().remove(path.as_ref()));
        std::fs::remove_file(&file).unwrap();
    }
    #[test]
    fn escaped_video_paths_roundtrip() {
        let source = video_source(r#"C:\clips\a "reaction".mp4"#, -1.0);
        let value: (String, f64) = serde_json::from_str(source.strip_prefix(VIDEO_PREFIX).unwrap()).unwrap();
        assert_eq!(value, (r#"C:\clips\a "reaction".mp4"#.to_string(), 0.0));
    }
    #[test]
    fn motion_is_resolution_independent_and_settles() {
        let rect = [10.0, 20.0, 300.0, 200.0];
        let (small, alpha) = animated_rect(rect, Some("rise"), 0.0, 540.0);
        let (large, _) = animated_rect(rect, Some("rise"), 0.0, 1080.0);
        assert_eq!(alpha, 0.0);
        assert!((large[1] - rect[1] - (small[1] - rect[1]) * 2.0).abs() < 0.001);
        for name in ["none", "fade", "rise", "pop", "slide-left", "pulse"] {
            let (settled, opacity) = animated_rect(rect, Some(name), 2.0, 1080.0);
            assert_eq!(settled, rect);
            assert_eq!(opacity, 1.0);
            assert_eq!(animated_rect(rect, Some(name), 3600.0, 1080.0), (rect, 1.0));
        }
    }

    #[test]
    fn original_png_keeps_transparent_pixels_and_partial_alpha() {
        let path = std::env::temp_dir().join(format!("reaction-png-alpha-{}.png", std::process::id()));
        let image = image::RgbaImage::from_raw(2, 1, vec![255, 0, 0, 0, 0, 255, 0, 128]).unwrap();
        image.save(&path).unwrap();
        let decoded = super::load(path.to_str().unwrap()).unwrap();
        assert_eq!(decoded.dimensions(), (2, 1));
        assert_eq!(decoded.as_raw(), image.as_raw());
        std::fs::remove_file(path).unwrap();
    }
}
