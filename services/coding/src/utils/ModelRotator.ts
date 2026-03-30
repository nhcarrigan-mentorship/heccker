import { Logger } from '@nestjs/common';

export class ModelRotator {
    private readonly logger = new Logger(ModelRotator.name);
    private models = [
        'gemini-2.5-flash-lite',
        'gemini-3.1-flash-lite-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash'
    ];
    private currentIndex = 0;

    constructor() {
        this.logger.log(`ModelRotator initialized with ${this.models.length} futuristic Gemini models.`);
    }

    getCurrentModel(): string {
        return this.models[this.currentIndex];
    }

    rotate(): string {
        this.currentIndex = (this.currentIndex + 1) % this.models.length;
        this.logger.warn(`Rotating to next fallback model: ${this.models[this.currentIndex]}`);
        return this.models[this.currentIndex];
    }

    getAvailableModels(): string[] {
        return this.models;
    }
}
