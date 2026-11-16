fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let r = ffr_core::parity::end_to_end(
        std::path::Path::new(&a[0]),
        std::path::Path::new(&a[1]),
        std::path::Path::new(&a[2]),
        std::path::Path::new(&a[3]),
    )?;
    println!("{}", serde_json::to_string_pretty(&r)?);
    Ok(())
}
