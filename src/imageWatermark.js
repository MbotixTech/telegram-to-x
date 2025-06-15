const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');

class ImageWatermark {
  constructor() {
    this.watermarkPath = config.paths.watermark;
  }

  async addWatermark(inputImagePath) {
    try {
      console.log(`🖼️ Adding watermark to: ${path.basename(inputImagePath)}`);
      
      // Ensure output directory exists
      await fs.ensureDir(config.paths.output);
      
      // Generate output filename
      const inputFilename = path.basename(inputImagePath, path.extname(inputImagePath));
      const outputPath = path.join(config.paths.output, `${inputFilename}_watermarked.jpg`);
      
      // Check if watermark file exists
      if (!await fs.pathExists(this.watermarkPath)) {
        throw new Error(`Watermark file not found: ${this.watermarkPath}`);
      }
      
      // Get input image metadata
      const inputImage = sharp(inputImagePath);
      const { width, height } = await inputImage.metadata();
      
      // Calculate watermark size (configurable % of image width, maintaining aspect ratio)
      const watermarkWidth = Math.floor(width * config.app.watermarkSize);
      
      // Prepare watermark with resize (PNG file already has transparency)
      const watermarkBuffer = await sharp(this.watermarkPath)
        .resize(watermarkWidth, null, {
          withoutEnlargement: true,
          fit: 'inside'
        })
        .toBuffer();
      
      // Get watermark dimensions after resize
      const watermarkMeta = await sharp(watermarkBuffer).metadata();
      
      // Calculate center position
      const left = Math.floor((width - watermarkMeta.width) / 2);
      const top = Math.floor((height - watermarkMeta.height) / 2);
      
      // Create semi-transparent watermark overlay
      const watermarkOverlay = await sharp({
        create: {
          width: width,
          height: height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
      .composite([
        {
          input: watermarkBuffer,
          left: left,
          top: top,
          blend: 'over'
        }
      ])
      .png()
      .toBuffer();
      
      // Apply watermark to original image with opacity
      await inputImage
        .composite([
          {
            input: watermarkOverlay,
            blend: 'over',
            opacity: config.app.watermarkOpacity
          }
        ])
        .jpeg({ quality: 90 })
        .toFile(outputPath);
      
      console.log(`✅ Watermark added successfully: ${path.basename(outputPath)}`);
      return outputPath;
      
    } catch (error) {
      console.error('❌ Error adding watermark:', error);
      throw new Error(`Failed to add watermark: ${error.message}`);
    }
  }

  async addWatermarkToMultiple(imagePaths) {
    const watermarkedPaths = [];
    
    for (const imagePath of imagePaths) {
      try {
        const watermarkedPath = await this.addWatermark(imagePath);
        watermarkedPaths.push(watermarkedPath);
      } catch (error) {
        console.error(`❌ Failed to watermark ${imagePath}:`, error);
        // Continue with other images even if one fails
      }
    }
    
    return watermarkedPaths;
  }

  async validateWatermark() {
    try {
      if (!await fs.pathExists(this.watermarkPath)) {
        throw new Error('Watermark file not found');
      }
      
      // Test if watermark is a valid image
      const metadata = await sharp(this.watermarkPath).metadata();
      
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid watermark image');
      }
      
      console.log(`✅ Watermark validated: ${metadata.width}x${metadata.height}`);
      return true;
      
    } catch (error) {
      console.error('❌ Watermark validation failed:', error);
      return false;
    }
  }

  async createSampleWatermark() {
    try {
      // Create a sample watermark if it doesn't exist
      await fs.ensureDir(path.dirname(this.watermarkPath));
      
      if (!await fs.pathExists(this.watermarkPath)) {
        console.log('🎨 Creating sample watermark...');
        
        // Create a simple text-based watermark
        const svg = `
          <svg width="300" height="100" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="black" flood-opacity="0.3"/>
              </filter>
            </defs>
            <text x="150" y="50" font-family="Arial, sans-serif" font-size="24" font-weight="bold" 
                  text-anchor="middle" dominant-baseline="middle" fill="white" filter="url(#shadow)">
              MuseOfCurves
            </text>
          </svg>
        `;
        
        await sharp(Buffer.from(svg))
          .png()
          .toFile(this.watermarkPath);
        
        console.log('✅ Sample watermark created');
      }
      
    } catch (error) {
      console.error('❌ Error creating sample watermark:', error);
    }
  }
}

module.exports = new ImageWatermark();