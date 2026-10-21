//! Lightweight, deterministic RGBA sprites shared by preview and every export backend.
use crate::scene::SceneCreative;
use image::{Rgba, RgbaImage};
const PREFIX: &str = "rs-creative-frame:";
const DIGITS: [[u8; 7]; 10] = [
    [14,17,19,21,25,17,14], [4,12,4,4,4,4,14], [14,17,1,2,4,8,31],
    [30,1,1,14,1,1,30], [2,6,10,18,31,2,2], [31,16,16,30,1,1,30],
    [14,16,16,30,17,17,14], [31,1,2,4,8,8,8], [14,17,17,14,17,17,14], [14,17,17,15,1,1,14],
];
fn random(seed: f32) -> f32 {
    let n = (seed * 127.1 + 311.7).sin() * 43758.546;
    n - n.floor()
}
pub fn source(settings: &SceneCreative, elapsed: f32, aspect: f32, radius: f32) -> String {
    format!("{PREFIX}{}", serde_json::json!([settings, elapsed.max(0.0), aspect, radius]))
}
pub fn load(source: &str) -> Option<anyhow::Result<RgbaImage>> {
    let payload = source.strip_prefix(PREFIX)?;
    Some((|| {
        let (settings, elapsed, aspect, radius): (SceneCreative, f32, f32, f32) = serde_json::from_str(payload)?;
        Ok(render(&settings, elapsed, aspect, radius))
    })())
}
pub fn render(settings: &SceneCreative, elapsed: f32, aspect: f32, radius: f32) -> RgbaImage {
    let width = 384u32;
    let height = (width as f32 / aspect.clamp(0.25, 4.0)).round().clamp(96.0, 768.0) as u32;
    let mut image = RgbaImage::new(width, height);
    let color = crate::frame_geometry::parse_hex(&settings.color).unwrap_or([0.4, 0.9, 0.65, 1.0]);
    let opacity = settings.opacity.clamp(0.0, 1.0);
    let size = settings.size.clamp(0.5, 3.0);
    let density = settings.density.clamp(0.1, 1.0);
    let phase = elapsed * settings.speed.clamp(0.25, 3.0) / 3.0;
    let mut paint = |x: f32, y: f32, alpha: f32| {
        if x < 0.0 || y < 0.0 || x >= width as f32 || y >= height as f32 { return; }
        let pixel = image.get_pixel_mut(x as u32, y as u32);
        *pixel = Rgba([(color[0]*255.0) as u8, (color[1]*255.0) as u8, (color[2]*255.0) as u8,
            pixel[3].max((255.0 * opacity * alpha.clamp(0.0,1.0)).round() as u8)]);
    };
    if settings.overlay == "matrix" {
        let scale = size.round().max(1.0) as u32;
        let columns = width / (8 * scale) + 1;
        for column in 0..columns {
            if random(column as f32 + 9.0) > density { continue; }
            let y = (random(column as f32 + 1.0) + phase).rem_euclid(1.0) * height as f32;
            for tail in 0..8 {
                let digit = DIGITS[(random((column*31+tail) as f32) * 10.0) as usize % 10];
                for row in 0..7 { for bit in 0..5 {
                    if digit[row] & (1 << (4-bit)) == 0 { continue; }
                    for dy in 0..scale { for dx in 0..scale {
                        let px = (column*8*scale + bit as u32*scale + dx) as f32;
                        let py = (y - (tail*9*scale) as f32 + (row as u32*scale+dy) as f32).rem_euclid(height as f32);
                        paint(px, py, 1.0 - tail as f32/9.0);
                    }}
                }}
            }
        }
    } else if settings.overlay == "dots" || settings.overlay == "particles" {
        let soft = settings.overlay == "particles";
        let count = (160.0*density).round() as u32;
        for i in 0..count {
            let x = random(i as f32+7.0) * width as f32;
            let y = (random(i as f32+101.0)+phase).rem_euclid(1.0) * height as f32;
            let radius = size * if soft { 5.0 } else { 1.5 };
            let extent = radius.ceil() as i32;
            for dy in -extent..=extent { for dx in -extent..=extent {
                let distance = ((dx*dx+dy*dy) as f32).sqrt() / radius;
                if distance <= 1.0 { paint(x+dx as f32,y+dy as f32,if soft { (1.0-distance).powi(2) } else { 0.8 }); }
            }}
        }
    }
    // The source's rounded corners remain transparent; the effect never paints the backdrop.
    let r = radius.clamp(0.0,0.5) * width.min(height) as f32;
    if r > 0.0 {
        for (x,y,pixel) in image.enumerate_pixels_mut() {
            let cx = (x as f32 + 0.5).clamp(r,width as f32-r);
            let cy = (y as f32 + 0.5).clamp(r,height as f32-r);
            if ((x as f32+0.5-cx).powi(2)+(y as f32+0.5-cy).powi(2)).sqrt() > r { pixel[3]=0; }
        }
    }
    image
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn effects_are_deterministic_animated_and_transparent() {
        for kind in ["matrix", "dots", "particles"] {
            let settings: SceneCreative = serde_json::from_value(serde_json::json!({"overlay":kind,"opacity":0.25,"speed":1,"density":1,"size":1,"color":"#67e8a5"})).unwrap();
            let a=render(&settings,0.0,16.0/9.0,0.2);
            assert_eq!(a,render(&settings,0.0,16.0/9.0,0.2));
            assert_ne!(a,render(&settings,0.5,16.0/9.0,0.2));
            assert!(a.pixels().any(|p|p[3]>0));
            assert!(a.pixels().all(|p|p[3]<=64));
            assert_eq!(a.get_pixel(0,0)[3],0);
        }
    }
}
