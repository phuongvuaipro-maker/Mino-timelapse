import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Play, Pause, Image as ImageIcon, Loader2, AlertCircle, Sparkles, Layers, Key, ChevronDown, Upload, Trash2, ImagePlus, ArrowRight, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type AppTab = 'base' | 'timelapse';
type GenerationState = 'idle' | 'generating' | 'done' | 'error';

interface GeneratedImage {
  url: string;
  prompt: string;
  stage: string;
}

function getTimelapsePrompts(targetPrompt: string, n: number, hasFinalImage: boolean): { stage: string, instruction: string }[] {
  const stages = [];
  const safePrompt = targetPrompt || "Final result";
  
  const stepSize = 100 / (n + 1);
  for (let i = 1; i <= n; i++) {
    const percent = Math.round(i * stepSize);
    stages.push({
      stage: `Stage ${i} (${percent}%)`,
      instruction: `Edit the image to show the ${percent}% completed stage of: ${safePrompt}. Show partial progression, construction, or formation. Keep the original background, composition, and unchanged parts exactly the same.`
    });
  }
  
  if (!hasFinalImage) {
    stages.push({
      stage: "Final Result",
      instruction: `Edit the image to show the fully completed, highly detailed final version of: ${safePrompt}. Perfectly integrate it into the environment while keeping the original background exactly the same.`
    });
  }
  
  return stages;
}

function downloadImage(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function App() {
  const [myApiKey, setMyApiKey] = useState('');
  const hasKey = myApiKey.trim().length > 0;

  const [activeTab, setActiveTab] = useState<AppTab>('base');
  
  // Base Image State
  const [basePrompt, setBasePrompt] = useState('An empty green meadow with mountains in the background');
  const [baseStyle, setBaseStyle] = useState('Photorealistic Landscape');
  const [numberOfImages, setNumberOfImages] = useState(1);
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);
  const [baseResults, setBaseResults] = useState<{url: string, data: string, mimeType: string}[]>([]);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageSize, setImageSize] = useState('1K');
  const [baseReferenceImage, setBaseReferenceImage] = useState<{ data: string, mimeType: string, url: string } | null>(null);

  // Timelapse State
  const [targetPrompt, setTargetPrompt] = useState('Build a futuristic cyberpunk city with glowing neon lights');
  const [steps, setSteps] = useState(3);
  const [initialImage, setInitialImage] = useState<{ data: string, mimeType: string, url: string } | null>(null);
  const [finalImage, setFinalImage] = useState<{ data: string, mimeType: string, url: string } | null>(null);
  
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-flash-image-preview');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const finalFileInputRef = useRef<HTMLInputElement>(null);
  const baseFileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<GenerationState>('idle');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const totalImages = steps + 2;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && images.length > 1) {
      interval = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= images.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, images.length]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      const base64Data = result.split(',')[1];
      setInitialImage({
        data: base64Data,
        mimeType: file.type,
        url: result
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFinalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      const base64Data = result.split(',')[1];
      setFinalImage({
        data: base64Data,
        mimeType: file.type,
        url: result
      });
    };
    reader.readAsDataURL(file);
  };

  const handleBaseReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      const base64Data = result.split(',')[1];
      setBaseReferenceImage({
        data: base64Data,
        mimeType: file.type,
        url: result
      });
    };
    reader.readAsDataURL(file);
  };

  const enhancePrompt = async () => {
    if (!basePrompt.trim()) return;
    setIsEnhancing(true);
    setError(null);
    try {
     const ai = new GoogleGenAI({ apiKey: myApiKey.trim() });
      const prompt = `You are an expert image generation prompt engineer. The user wants to generate an image of: "${basePrompt}". The desired style is: "${baseStyle}". Write a highly detailed, descriptive prompt (under 500 characters) that will yield a stunning image. Just return the prompt text, nothing else.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      
      if (response.text) {
        setBasePrompt(response.text.trim());
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to enhance prompt.");
    } finally {
      setIsEnhancing(false);
    }
  };

  const generateBaseImage = async () => {
    if (!basePrompt.trim()) return;
    setIsGeneratingBase(true);
    setError(null);
    setBaseResults([]);
    
    try {
      const ai = new GoogleGenAI({ apiKey: myApiKey.trim() });
      
      let finalPrompt = basePrompt;
      if (baseStyle === 'Creative') {
        try {
          const enhancePromptText = `You are an expert image generation prompt engineer. The user wants to generate an image of: "${basePrompt}". Write a highly detailed, descriptive, and imaginative prompt (under 500 characters) that will yield a stunning, creative image. Just return the prompt text, nothing else.`;
          const enhanceResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: enhancePromptText,
          });
          if (enhanceResponse.text) {
            finalPrompt = enhanceResponse.text.trim();
          }
        } catch (e) {
          console.warn("Auto-enhance for creative style failed", e);
        }
      }

      let fullPrompt = `${finalPrompt}. Style: ${baseStyle}. High quality, 8k resolution, highly detailed.`;
      if (baseReferenceImage) {
        fullPrompt = `Use the provided reference image as a base. Transform it according to this description: ${fullPrompt}`;
      }
      
      const config: any = { imageConfig: { aspectRatio } };
      if (selectedModel !== 'gemini-2.5-flash-image') {
        config.imageConfig.imageSize = imageSize;
      }

      const contents: any = { parts: [] };
      if (baseReferenceImage) {
        contents.parts.push({
          inlineData: {
            data: baseReferenceImage.data,
            mimeType: baseReferenceImage.mimeType
          }
        });
      }
      contents.parts.push({ text: fullPrompt });

      const generatePromises = Array.from({ length: numberOfImages }).map(async () => {
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents,
          config
        });

        let url = '';
        let data = '';
        let mimeType = '';
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            data = part.inlineData.data;
            mimeType = part.inlineData.mimeType;
            url = `data:${mimeType};base64,${data}`;
            break;
          }
        }
        if (!url) throw new Error("Failed to generate base image");
        return { url, data, mimeType };
      });

      const results = await Promise.all(generatePromises);
      setBaseResults(results);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred.");
    } finally {
      setIsGeneratingBase(false);
    }
  };

  const generateSequence = async () => {
    if (!targetPrompt.trim() || !initialImage) {
      setError("Please provide a starting image and a target prompt.");
      return;
    }
    
    setState('generating');
    setError(null);
    setImages([]);
    setCurrentIndex(0);
    setIsPlaying(false);

    const stages = getTimelapsePrompts(targetPrompt, steps, !!finalImage);
    const newImages: GeneratedImage[] = [];
    
    let previousImageBase64 = initialImage.data;
    let previousImageMimeType = initialImage.mimeType;

    newImages.push({
      url: initialImage.url,
      prompt: "Original Image",
      stage: "Original"
    });
    setImages([...newImages]);

    try {
      for (let i = 0; i < stages.length; i++) {
        const ai = new GoogleGenAI({ apiKey: myApiKey.trim() });
        const currentStage = stages[i];

        const config: any = { imageConfig: { aspectRatio } };
        if (selectedModel !== 'gemini-2.5-flash-image') {
          config.imageConfig.imageSize = imageSize;
        }

        const contents = {
          parts: [
            {
              inlineData: {
                data: previousImageBase64,
                mimeType: previousImageMimeType
              }
            },
            { text: currentStage.instruction }
          ]
        };

        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: contents,
          config: config
        });

        let url = '';
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            previousImageBase64 = part.inlineData.data;
            previousImageMimeType = part.inlineData.mimeType;
            url = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }

        if (!url) throw new Error(`Failed to generate image for stage ${i + 1}`);

        const newImg = { url, prompt: currentStage.instruction, stage: currentStage.stage };
        newImages.push(newImg);
        setImages([...newImages]);
        setCurrentIndex(newImages.length - 1);
      }
      
      if (finalImage) {
        newImages.push({
          url: finalImage.url,
          prompt: "Provided Final Image",
          stage: "Final Result"
        });
        setImages([...newImages]);
        setCurrentIndex(newImages.length - 1);
      }
      
      setState('done');
    } catch (err: any) {
      console.error(err);
      const errMsg = err.message || "An error occurred during generation.";
      setError(errMsg);
      setState('error');
    }
  };

  const togglePlay = () => {
    if (currentIndex >= images.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex font-sans">
      {/* Left Panel */}
      <div className="w-80 border-r border-zinc-800/60 bg-zinc-900/40 p-6 flex flex-col h-screen overflow-y-auto backdrop-blur-xl z-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="text-white" size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Mino Timelapse</h1>
        </div>

        <div className="space-y-8 flex-1">
          {/* API Configuration Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">API Configuration</h3>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4">
              <div className="space-y-3">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Key size={14} className="text-indigo-400" />
                  Gemini API Key
                </label>
                <input
                  type="password"
                  value={myApiKey}
                  onChange={(e) => setMyApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-zinc-300 transition-all placeholder:text-zinc-600"
                />
                <p className="text-xs text-zinc-500">
                  Your key is stored locally and never sent to our servers.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-300">AI Model</label>
            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl p-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-zinc-300 appearance-none pr-10"
              >
                <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash (Recommended)</option>
                <option value="gemini-3-pro-image-preview">Gemini 3 Pro (High Quality)</option>
                <option value="gemini-2.5-flash-image">Gemini 2.5 Flash (Fast)</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex bg-zinc-950/50 p-1 rounded-xl border border-zinc-800">
              <button
                onClick={() => setActiveTab('base')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${activeTab === 'base' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <ImagePlus size={16} />
                1. Base Image
              </button>
              <button
                onClick={() => setActiveTab('timelapse')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${activeTab === 'timelapse' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <Layers size={16} />
                2. Timelapse
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'base' ? (
              <motion.div
                key="base"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="space-y-3">
                  <label className="text-sm font-medium text-zinc-300 flex justify-between">
                    <span>Reference Image (Optional)</span>
                    {baseReferenceImage && <span className="text-emerald-400 text-xs">Added</span>}
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={baseFileInputRef}
                    onChange={handleBaseReferenceUpload}
                    className="hidden"
                  />
                  {baseReferenceImage ? (
                    <div className="relative rounded-xl overflow-hidden border border-zinc-800 group h-24">
                      <img src={baseReferenceImage.url} alt="Reference" className="w-full h-full object-cover opacity-80" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => baseFileInputRef.current?.click()}
                          className="bg-zinc-800/80 hover:bg-zinc-700 text-white p-2 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <Upload size={16} />
                        </button>
                        <button
                          onClick={() => setBaseReferenceImage(null)}
                          className="bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => baseFileInputRef.current?.click()}
                      className="w-full h-16 border-2 border-dashed border-zinc-800 hover:border-indigo-500/50 rounded-xl flex items-center justify-center gap-2 text-zinc-500 hover:text-indigo-400 transition-colors bg-zinc-950/30"
                    >
                      <Upload size={16} />
                      <span className="text-sm font-medium">Upload reference image</span>
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-zinc-300">Image Description</label>
                    <button
                      onClick={enhancePrompt}
                      disabled={isEnhancing || !basePrompt.trim() || !hasKey}
                      className="text-xs flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 transition-colors bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1 rounded-md"
                    >
                      {isEnhancing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      Enhance Prompt
                    </button>
                  </div>
                  <textarea
                    value={basePrompt}
                    onChange={(e) => setBasePrompt(e.target.value)}
                    placeholder="Describe the starting scene..."
                    className="w-full h-32 bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 resize-none transition-all placeholder:text-zinc-600"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-zinc-300">Style</label>
                    <div className="relative">
                      <select
                        value={baseStyle}
                        onChange={(e) => setBaseStyle(e.target.value)}
                        className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl p-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-zinc-300 appearance-none pr-10"
                      >
                        <option value="Photorealistic Landscape">Photorealistic Landscape</option>
                        <option value="Architectural Photography">Architectural Photography</option>
                        <option value="Studio Portrait">Studio Portrait</option>
                        <option value="Concept Art">Concept Art</option>
                        <option value="3D Render">3D Render</option>
                        <option value="Minimalist Sketch">Minimalist Sketch</option>
                        <option value="Fashion Photography">Fashion Photography</option>
                        <option value="Makeup & Beauty">Makeup & Beauty</option>
                        <option value="Nature & Wildlife">Nature & Wildlife</option>
                        <option value="Creative">Creative (Auto-Enhance)</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-zinc-300">Number of Images</label>
                    <div className="relative">
                      <select
                        value={numberOfImages}
                        onChange={(e) => setNumberOfImages(parseInt(e.target.value))}
                        className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl p-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-zinc-300 appearance-none pr-10"
                      >
                        <option value={1}>1 Image</option>
                        <option value={2}>2 Images</option>
                        <option value={3}>3 Images</option>
                        <option value={4}>4 Images</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-400">Aspect Ratio</label>
                    <div className="relative">
                      <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-zinc-300 appearance-none pr-8"
                      >
                        <option value="1:1">1:1 (Square)</option>
                        <option value="4:3">4:3 (Landscape)</option>
                        <option value="3:4">3:4 (Portrait)</option>
                        <option value="16:9">16:9 (Widescreen)</option>
                        <option value="9:16">9:16 (Vertical)</option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={14} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-400">Resolution</label>
                    <div className="relative">
                      <select
                        value={imageSize}
                        onChange={(e) => setImageSize(e.target.value)}
                        disabled={selectedModel === 'gemini-2.5-flash-image'}
                        className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-zinc-300 appearance-none pr-8 disabled:opacity-50"
                      >
                        <option value="512px">512px</option>
                        <option value="1K">1K</option>
                        <option value="2K">2K</option>
                        <option value="4K">4K</option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={14} />
                    </div>
                  </div>
                </div>

                <button
                  onClick={generateBaseImage}
                  disabled={isGeneratingBase || !basePrompt.trim() || !hasKey}
                  className="w-full bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 font-medium py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-white/5"
                >
                  {isGeneratingBase ? (
                    <><Loader2 size={18} className="animate-spin" /> Generating...</>
                  ) : (
                    <><Sparkles size={18} /> Generate Base Image</>
                  )}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="timelapse"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="space-y-3">
                  <label className="text-sm font-medium text-zinc-300 flex justify-between">
                    <span>Starting Image</span>
                    {initialImage && <span className="text-emerald-400 text-xs">Ready</span>}
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  {initialImage ? (
                    <div className="relative rounded-xl overflow-hidden border border-zinc-800 group">
                      <img src={initialImage.url} alt="Starting point" className="w-full h-32 object-cover opacity-80" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="bg-zinc-800/80 hover:bg-zinc-700 text-white p-2 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <Upload size={16} />
                        </button>
                        <button
                          onClick={() => setInitialImage(null)}
                          className="bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-32 border-2 border-dashed border-zinc-800 hover:border-indigo-500/50 rounded-xl flex flex-col items-center justify-center gap-2 text-zinc-500 hover:text-indigo-400 transition-colors bg-zinc-950/30"
                    >
                      <Upload size={20} />
                      <span className="text-sm font-medium">Upload starting image</span>
                      <span className="text-xs text-zinc-600">or generate one in Step 1</span>
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-zinc-300 flex justify-between">
                    <span>Final Image (Optional)</span>
                    {finalImage && <span className="text-emerald-400 text-xs">Ready</span>}
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={finalFileInputRef}
                    onChange={handleFinalImageUpload}
                    className="hidden"
                  />
                  {finalImage ? (
                    <div className="relative rounded-xl overflow-hidden border border-zinc-800 group">
                      <img src={finalImage.url} alt="Final point" className="w-full h-24 object-cover opacity-80" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => finalFileInputRef.current?.click()}
                          className="bg-zinc-800/80 hover:bg-zinc-700 text-white p-2 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <Upload size={16} />
                        </button>
                        <button
                          onClick={() => setFinalImage(null)}
                          className="bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-lg backdrop-blur-sm transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => finalFileInputRef.current?.click()}
                      className="w-full h-20 border-2 border-dashed border-zinc-800 hover:border-indigo-500/50 rounded-xl flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-indigo-400 transition-colors bg-zinc-950/30"
                    >
                      <Upload size={16} />
                      <span className="text-xs font-medium">Upload final image</span>
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-zinc-300">Target Transformation</label>
                  <textarea
                    value={targetPrompt}
                    onChange={(e) => setTargetPrompt(e.target.value)}
                    placeholder="Describe the final result..."
                    className="w-full h-24 bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 resize-none transition-all placeholder:text-zinc-600"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-zinc-300">Intermediate Steps</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={steps}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) setSteps(Math.max(1, Math.min(20, val)));
                      }}
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-sm text-zinc-300 text-center focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={steps}
                    onChange={(e) => setSteps(parseInt(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-zinc-500 font-medium">
                    <span>1 step</span>
                    <span>20 steps</span>
                  </div>
                </div>

                <button
                  onClick={generateSequence}
                  disabled={state === 'generating' || !targetPrompt.trim() || !hasKey || !initialImage}
                  className="w-full bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 font-medium py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-white/5"
                >
                  {state === 'generating' ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Generating {images.length}/{totalImages}...
                    </>
                  ) : (
                    <>
                      <Layers size={18} />
                      Generate Timelapse
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col h-screen relative overflow-hidden bg-zinc-950">
        {/* Viewer Area */}
        <div className="flex-1 flex items-center justify-center p-8 relative">
          {/* Background subtle gradient */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.05)_0%,transparent_70%)] pointer-events-none" />
          
          {activeTab === 'base' ? (
            <div className="w-full h-full relative flex items-center justify-center z-10 p-8 overflow-y-auto">
              {baseResults.length > 0 ? (
                <div className={`grid gap-6 w-full max-w-5xl ${baseResults.length === 1 ? 'grid-cols-1 max-w-3xl' : baseResults.length === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-2'}`}>
                  {baseResults.map((result, idx) => (
                    <div key={idx} className="w-full aspect-square relative rounded-2xl overflow-hidden shadow-2xl shadow-black border border-zinc-800/50 bg-zinc-900 group">
                      <img 
                        src={result.url} 
                        alt={`Base generated ${idx + 1}`} 
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-zinc-300 shadow-xl flex items-center gap-2">
                        <span>{aspectRatio}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
                        <span>{selectedModel === 'gemini-2.5-flash-image' ? 'Default' : imageSize}</span>
                      </div>
                      <button
                        onClick={() => downloadImage(result.url, `base-image-${idx + 1}.jpg`)}
                        className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 backdrop-blur-md p-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white shadow-xl transition-colors z-20"
                        title="Download Image"
                      >
                        <Download size={16} />
                      </button>
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                        <button
                          onClick={() => {
                            setInitialImage(result);
                            setActiveTab('timelapse');
                          }}
                          className="bg-zinc-800/90 hover:bg-zinc-700 text-white font-medium py-2 px-4 rounded-xl flex items-center gap-2 shadow-xl transition-transform hover:scale-105 backdrop-blur-sm border border-white/10"
                        >
                          Set as Start
                        </button>
                        <button
                          onClick={() => {
                            setFinalImage(result);
                            setActiveTab('timelapse');
                          }}
                          className="bg-indigo-500/90 hover:bg-indigo-600 text-white font-medium py-2 px-4 rounded-xl flex items-center gap-2 shadow-xl transition-transform hover:scale-105 backdrop-blur-sm border border-white/10"
                        >
                          Set as Final <ArrowRight size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : isGeneratingBase ? (
                <div className="w-full max-w-3xl aspect-square rounded-2xl border-2 border-zinc-800 border-dashed flex flex-col items-center justify-center text-zinc-500 bg-zinc-900/20 backdrop-blur-sm">
                  <Loader2 size={48} className="animate-spin mb-6 text-indigo-500" />
                  <p className="text-lg font-medium text-zinc-300">Generating {numberOfImages > 1 ? `${numberOfImages} base images` : 'base image'}...</p>
                </div>
              ) : (
                <div className="text-center max-w-md relative z-10">
                  <div className="w-24 h-24 bg-zinc-900/80 backdrop-blur-sm rounded-3xl flex items-center justify-center mx-auto mb-8 border border-zinc-800/80 shadow-2xl">
                    <ImagePlus size={40} className="text-zinc-600" />
                  </div>
                  <h2 className="text-3xl font-semibold mb-3 tracking-tight">Step 1: Base Image</h2>
                  <p className="text-zinc-500 text-base leading-relaxed">
                    Generate a starting image from text, or skip to Step 2 to upload your own.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              {state === 'idle' && images.length === 0 ? (
                <div className="text-center max-w-md relative z-10">
                  <div className="w-24 h-24 bg-zinc-900/80 backdrop-blur-sm rounded-3xl flex items-center justify-center mx-auto mb-8 border border-zinc-800/80 shadow-2xl">
                    <Layers size={40} className="text-zinc-600" />
                  </div>
                  <h2 className="text-3xl font-semibold mb-3 tracking-tight">Step 2: Timelapse</h2>
                  <p className="text-zinc-500 text-base leading-relaxed">
                    Provide a starting image and describe the final result to generate a transformation sequence.
                  </p>
                </div>
              ) : (
                <div className="w-full max-w-3xl aspect-square relative flex items-center justify-center z-10">
                  <AnimatePresence mode="wait">
                    {images[currentIndex] ? (
                      <motion.div
                        key={currentIndex}
                        initial={{ opacity: 0, scale: 0.96, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 1.02, filter: 'blur(10px)' }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className="w-full h-full relative rounded-2xl overflow-hidden shadow-2xl shadow-black border border-zinc-800/50 bg-zinc-900"
                      >
                        <img 
                          src={images[currentIndex].url} 
                          alt={`Stage ${currentIndex + 1}`} 
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-5 left-5 bg-black/40 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/10 text-sm font-medium shadow-xl flex flex-col gap-1">
                          <span>{images[currentIndex].stage}</span>
                          <span className="text-xs text-zinc-400 font-normal">
                            {aspectRatio} • {selectedModel === 'gemini-2.5-flash-image' ? 'Default' : imageSize}
                          </span>
                        </div>
                        <button
                          onClick={() => downloadImage(images[currentIndex].url, `timelapse-stage-${currentIndex + 1}.jpg`)}
                          className="absolute top-5 right-5 bg-black/40 hover:bg-black/60 backdrop-blur-xl p-2.5 rounded-xl border border-white/10 text-zinc-300 hover:text-white shadow-xl transition-colors z-20"
                          title="Download Image"
                        >
                          <Download size={18} />
                        </button>
                      </motion.div>
                    ) : state === 'generating' ? (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="w-full h-full rounded-2xl border-2 border-zinc-800 border-dashed flex flex-col items-center justify-center text-zinc-500 bg-zinc-900/20 backdrop-blur-sm"
                      >
                        <Loader2 size={48} className="animate-spin mb-6 text-indigo-500" />
                        <p className="text-lg font-medium text-zinc-300">Generating stage {images.length + 1} of {totalImages}...</p>
                        <p className="text-sm text-zinc-500 mt-2">This may take a minute</p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
          
          {error && (
            <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500/20 text-red-400 px-5 py-4 rounded-2xl flex items-center gap-3 max-w-md w-full backdrop-blur-xl shadow-2xl z-50">
              <AlertCircle size={24} className="shrink-0" />
              <p className="text-sm font-medium leading-relaxed">{error}</p>
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        {activeTab === 'timelapse' && (images.length > 0 || state === 'generating') && (
          <div className="h-32 border-t border-zinc-800/60 bg-zinc-900/40 backdrop-blur-xl p-6 flex items-center gap-8 z-20">
            <button 
              onClick={togglePlay}
              disabled={images.length < 2}
              className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all shrink-0 shadow-lg shadow-white/5 active:scale-95"
            >
              {isPlaying ? <Pause size={24} className="fill-current" /> : <Play size={24} className="fill-current ml-1" />}
            </button>
            
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex justify-between text-xs font-semibold tracking-wider uppercase text-zinc-500 px-1">
                <span>Start</span>
                <span>Final</span>
              </div>
              <div className="relative flex items-center h-8 group">
                {/* Custom track */}
                <div className="absolute left-0 right-0 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                    style={{ width: `${(currentIndex / Math.max(1, totalImages - 1)) * 100}%` }}
                  />
                </div>
                {/* Custom markers */}
                <div className="absolute left-0 right-0 flex justify-between px-1 pointer-events-none">
                  {Array.from({ length: totalImages }).map((_, i) => (
                    <div 
                      key={i} 
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        i <= currentIndex ? 'bg-white scale-125' : 'bg-zinc-600'
                      } ${i < images.length ? 'shadow-[0_0_12px_rgba(255,255,255,0.8)]' : ''}`}
                    />
                  ))}
                </div>
                {/* Actual input */}
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, images.length - 1)}
                  value={currentIndex}
                  onChange={(e) => {
                    setCurrentIndex(parseInt(e.target.value));
                    setIsPlaying(false);
                  }}
                  disabled={images.length === 0}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer"
                />
              </div>
            </div>
            
            <div className="text-sm font-mono font-medium text-zinc-400 w-16 text-right shrink-0 bg-zinc-800/50 py-2 px-3 rounded-lg border border-zinc-700/50">
              {images.length > 0 ? `${currentIndex + 1}/${images.length}` : '0/0'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
