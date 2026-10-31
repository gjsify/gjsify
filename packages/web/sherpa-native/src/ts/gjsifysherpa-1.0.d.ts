// oxlint-disable typescript/no-explicit-any -- generated ts-for-gir .d.ts (see file header). Constructor/_init rest-args and GObject signal-handler (...args: any[]) => any patterns come from the ts-for-gir template; fixes belong upstream in https://github.com/gjsify/ts-for-gir, not in this generated file
/**
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in `ts-for-gir` or create a bug report on https://github.com/gjsify/ts-for-gir
 *
 * The based EJS template file is used for the generated .d.ts file of each GIR module like Gtk-4.0, GObject-2.0, ...
 */

declare module 'gi://GjsifySherpa?version=1.0' {
    // Module dependencies
    import type GObject from '@girs/gobject-2.0';
    import type GLib from '@girs/glib-2.0';

    export namespace GjsifySherpa {
        /**
         * GjsifySherpa-1.0
         */

        /**
         * @gir-type Struct
         */
        class SherpaError extends GLib.Error {
            static $gtype: GObject.GType<GLib.Error>;

            // Static fields
            static MODEL_MISSING: number;

            static OPEN_FAILED: number;

            static NOT_OPEN: number;

            // Constructors
            constructor(options: { message: string; code: number });
        }

        function version(): string;

        function onnxruntime_version(): string;

        /**
         * @param path
         */
        function file_exists(path: string): boolean;

        namespace Vad {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                'notify::model': (pspec: GObject.ParamSpec) => void;
                'notify::threshold': (pspec: GObject.ParamSpec) => void;
                'notify::min-silence-duration': (pspec: GObject.ParamSpec) => void;
                'notify::min-speech-duration': (pspec: GObject.ParamSpec) => void;
                'notify::max-speech-duration': (pspec: GObject.ParamSpec) => void;
                'notify::window-size': (pspec: GObject.ParamSpec) => void;
                'notify::sample-rate': (pspec: GObject.ParamSpec) => void;
                'notify::num-threads': (pspec: GObject.ParamSpec) => void;
                'notify::buffer-size-in-seconds': (pspec: GObject.ParamSpec) => void;
                'notify::enable-debug': (pspec: GObject.ParamSpec) => void;
                'notify::is-open': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface
            interface ConstructorProps extends GObject.Object.ConstructorProps {
                model: string;
                threshold: number;
                min_silence_duration: number;
                minSilenceDuration: number;
                min_speech_duration: number;
                minSpeechDuration: number;
                max_speech_duration: number;
                maxSpeechDuration: number;
                window_size: number;
                windowSize: number;
                sample_rate: number;
                sampleRate: number;
                num_threads: number;
                numThreads: number;
                buffer_size_in_seconds: number;
                bufferSizeInSeconds: number;
                enable_debug: boolean;
                enableDebug: boolean;
                is_open: boolean;
                isOpen: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class Vad extends GObject.Object {
            static $gtype: GObject.GType<Vad>;

            // Properties
            /**
             * @construct-only
             */
            get model(): string;

            get threshold(): number;
            set threshold(val: number);

            get min_silence_duration(): number;
            set min_silence_duration(val: number);

            get minSilenceDuration(): number;
            set minSilenceDuration(val: number);

            get min_speech_duration(): number;
            set min_speech_duration(val: number);

            get minSpeechDuration(): number;
            set minSpeechDuration(val: number);

            get max_speech_duration(): number;
            set max_speech_duration(val: number);

            get maxSpeechDuration(): number;
            set maxSpeechDuration(val: number);

            get window_size(): number;
            set window_size(val: number);

            get windowSize(): number;
            set windowSize(val: number);

            get sample_rate(): number;
            set sample_rate(val: number);

            get sampleRate(): number;
            set sampleRate(val: number);

            get num_threads(): number;
            set num_threads(val: number);

            get numThreads(): number;
            set numThreads(val: number);

            get buffer_size_in_seconds(): number;
            set buffer_size_in_seconds(val: number);

            get bufferSizeInSeconds(): number;
            set bufferSizeInSeconds(val: number);

            get enable_debug(): boolean;
            set enable_debug(val: boolean);

            get enableDebug(): boolean;
            set enableDebug(val: boolean);

            /**
             * @read-only
             */
            get is_open(): boolean;

            /**
             * @read-only
             */
            get isOpen(): boolean;

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: Vad.SignalSignatures;

            // Constructors
            constructor(properties?: Partial<Vad.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            static ['new'](model: string): Vad;

            // Signals
            /** @signal */
            connect<K extends keyof Vad.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Vad.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            connect_after<K extends keyof Vad.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Vad.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            emit<K extends keyof Vad.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<Vad.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods
            open(): void;

            close(): void;

            /**
             * @param samples
             */
            accept(samples: number[]): void;

            is_speech(): boolean;

            has_segment(): boolean;

            flush(): void;

            clear(): void;

            reset(): void;

            next_segment(): [boolean, number[], number];

            get_model(): string;

            get_threshold(): number;

            /**
             * @param value
             */
            set_threshold(value: number): void;

            get_min_silence_duration(): number;

            /**
             * @param value
             */
            set_min_silence_duration(value: number): void;

            get_min_speech_duration(): number;

            /**
             * @param value
             */
            set_min_speech_duration(value: number): void;

            get_max_speech_duration(): number;

            /**
             * @param value
             */
            set_max_speech_duration(value: number): void;

            get_window_size(): number;

            /**
             * @param value
             */
            set_window_size(value: number): void;

            get_sample_rate(): number;

            /**
             * @param value
             */
            set_sample_rate(value: number): void;

            get_num_threads(): number;

            /**
             * @param value
             */
            set_num_threads(value: number): void;

            get_buffer_size_in_seconds(): number;

            /**
             * @param value
             */
            set_buffer_size_in_seconds(value: number): void;

            get_enable_debug(): boolean;

            /**
             * @param value
             */
            set_enable_debug(value: boolean): void;

            get_is_open(): boolean;
        }

        namespace OnlineRecognizer {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                'notify::encoder': (pspec: GObject.ParamSpec) => void;
                'notify::decoder': (pspec: GObject.ParamSpec) => void;
                'notify::joiner': (pspec: GObject.ParamSpec) => void;
                'notify::tokens': (pspec: GObject.ParamSpec) => void;
                'notify::model-type': (pspec: GObject.ParamSpec) => void;
                'notify::provider': (pspec: GObject.ParamSpec) => void;
                'notify::num-threads': (pspec: GObject.ParamSpec) => void;
                'notify::decoding-method': (pspec: GObject.ParamSpec) => void;
                'notify::max-active-paths': (pspec: GObject.ParamSpec) => void;
                'notify::hotwords-score': (pspec: GObject.ParamSpec) => void;
                'notify::blank-penalty': (pspec: GObject.ParamSpec) => void;
                'notify::enable-endpoint': (pspec: GObject.ParamSpec) => void;
                'notify::rule1-min-trailing-silence': (pspec: GObject.ParamSpec) => void;
                'notify::rule2-min-trailing-silence': (pspec: GObject.ParamSpec) => void;
                'notify::rule3-min-utterance-length': (pspec: GObject.ParamSpec) => void;
                'notify::sample-rate': (pspec: GObject.ParamSpec) => void;
                'notify::feature-dim': (pspec: GObject.ParamSpec) => void;
                'notify::enable-debug': (pspec: GObject.ParamSpec) => void;
                'notify::is-open': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface
            interface ConstructorProps extends GObject.Object.ConstructorProps {
                encoder: string;
                decoder: string;
                joiner: string;
                tokens: string;
                model_type: string | null;
                modelType: string;
                provider: string;
                num_threads: number;
                numThreads: number;
                decoding_method: string;
                decodingMethod: string;
                max_active_paths: number;
                maxActivePaths: number;
                hotwords_score: number;
                hotwordsScore: number;
                blank_penalty: number;
                blankPenalty: number;
                enable_endpoint: boolean;
                enableEndpoint: boolean;
                rule1_min_trailing_silence: number;
                rule1MinTrailingSilence: number;
                rule2_min_trailing_silence: number;
                rule2MinTrailingSilence: number;
                rule3_min_utterance_length: number;
                rule3MinUtteranceLength: number;
                sample_rate: number;
                sampleRate: number;
                feature_dim: number;
                featureDim: number;
                enable_debug: boolean;
                enableDebug: boolean;
                is_open: boolean;
                isOpen: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class OnlineRecognizer extends GObject.Object {
            static $gtype: GObject.GType<OnlineRecognizer>;

            // Properties
            /**
             * @construct-only
             */
            get encoder(): string;

            /**
             * @construct-only
             */
            get decoder(): string;

            /**
             * @construct-only
             */
            get joiner(): string;

            /**
             * @construct-only
             */
            get tokens(): string;

            get model_type(): string | null;
            set model_type(val: string | null);

            get modelType(): string;
            set modelType(val: string);

            get provider(): string;
            set provider(val: string);

            get num_threads(): number;
            set num_threads(val: number);

            get numThreads(): number;
            set numThreads(val: number);

            get decoding_method(): string;
            set decoding_method(val: string);

            get decodingMethod(): string;
            set decodingMethod(val: string);

            get max_active_paths(): number;
            set max_active_paths(val: number);

            get maxActivePaths(): number;
            set maxActivePaths(val: number);

            get hotwords_score(): number;
            set hotwords_score(val: number);

            get hotwordsScore(): number;
            set hotwordsScore(val: number);

            get blank_penalty(): number;
            set blank_penalty(val: number);

            get blankPenalty(): number;
            set blankPenalty(val: number);

            get enable_endpoint(): boolean;
            set enable_endpoint(val: boolean);

            get enableEndpoint(): boolean;
            set enableEndpoint(val: boolean);

            get rule1_min_trailing_silence(): number;
            set rule1_min_trailing_silence(val: number);

            get rule1MinTrailingSilence(): number;
            set rule1MinTrailingSilence(val: number);

            get rule2_min_trailing_silence(): number;
            set rule2_min_trailing_silence(val: number);

            get rule2MinTrailingSilence(): number;
            set rule2MinTrailingSilence(val: number);

            get rule3_min_utterance_length(): number;
            set rule3_min_utterance_length(val: number);

            get rule3MinUtteranceLength(): number;
            set rule3MinUtteranceLength(val: number);

            get sample_rate(): number;
            set sample_rate(val: number);

            get sampleRate(): number;
            set sampleRate(val: number);

            get feature_dim(): number;
            set feature_dim(val: number);

            get featureDim(): number;
            set featureDim(val: number);

            get enable_debug(): boolean;
            set enable_debug(val: boolean);

            get enableDebug(): boolean;
            set enableDebug(val: boolean);

            /**
             * @read-only
             */
            get is_open(): boolean;

            /**
             * @read-only
             */
            get isOpen(): boolean;

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: OnlineRecognizer.SignalSignatures;

            // Constructors
            constructor(properties?: Partial<OnlineRecognizer.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            static ['new'](encoder: string, decoder: string, joiner: string, tokens: string): OnlineRecognizer;

            // Signals
            /** @signal */
            connect<K extends keyof OnlineRecognizer.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OnlineRecognizer.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            connect_after<K extends keyof OnlineRecognizer.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OnlineRecognizer.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            emit<K extends keyof OnlineRecognizer.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<OnlineRecognizer.SignalSignatures[K]> extends [any, ...infer Q]
                    ? Q
                    : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods
            open(): void;

            close(): void;

            /**
             * @param hotwords
             */
            create_stream(hotwords: string | null): OnlineStream;

            get_encoder(): string;

            get_decoder(): string;

            get_joiner(): string;

            get_tokens(): string;

            get_model_type(): string | null;

            /**
             * @param value
             */
            set_model_type(value: string | null): void;

            get_provider(): string;

            /**
             * @param value
             */
            set_provider(value: string): void;

            get_num_threads(): number;

            /**
             * @param value
             */
            set_num_threads(value: number): void;

            get_decoding_method(): string;

            /**
             * @param value
             */
            set_decoding_method(value: string): void;

            get_max_active_paths(): number;

            /**
             * @param value
             */
            set_max_active_paths(value: number): void;

            get_hotwords_score(): number;

            /**
             * @param value
             */
            set_hotwords_score(value: number): void;

            get_blank_penalty(): number;

            /**
             * @param value
             */
            set_blank_penalty(value: number): void;

            get_enable_endpoint(): boolean;

            /**
             * @param value
             */
            set_enable_endpoint(value: boolean): void;

            get_rule1_min_trailing_silence(): number;

            /**
             * @param value
             */
            set_rule1_min_trailing_silence(value: number): void;

            get_rule2_min_trailing_silence(): number;

            /**
             * @param value
             */
            set_rule2_min_trailing_silence(value: number): void;

            get_rule3_min_utterance_length(): number;

            /**
             * @param value
             */
            set_rule3_min_utterance_length(value: number): void;

            get_sample_rate(): number;

            /**
             * @param value
             */
            set_sample_rate(value: number): void;

            get_feature_dim(): number;

            /**
             * @param value
             */
            set_feature_dim(value: number): void;

            get_enable_debug(): boolean;

            /**
             * @param value
             */
            set_enable_debug(value: boolean): void;

            get_is_open(): boolean;
        }

        namespace OnlineStream {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                'notify::is-open': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface
            interface ConstructorProps extends GObject.Object.ConstructorProps {
                is_open: boolean;
                isOpen: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class OnlineStream extends GObject.Object {
            static $gtype: GObject.GType<OnlineStream>;

            // Properties
            /**
             * @read-only
             */
            get is_open(): boolean;

            /**
             * @read-only
             */
            get isOpen(): boolean;

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: OnlineStream.SignalSignatures;

            // Constructors
            constructor(properties?: Partial<OnlineStream.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            // Signals
            /** @signal */
            connect<K extends keyof OnlineStream.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OnlineStream.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            connect_after<K extends keyof OnlineStream.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OnlineStream.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            emit<K extends keyof OnlineStream.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<OnlineStream.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods
            close(): void;

            /**
             * @param sample_rate
             * @param samples
             */
            accept(sample_rate: number, samples: number[]): void;

            input_finished(): void;

            is_ready(): boolean;

            is_endpoint(): boolean;

            decode(): void;

            reset(): void;

            get_text(): string;

            get_json(): string;

            get_is_open(): boolean;
        }

        namespace OfflineRecognizer {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                'notify::encoder': (pspec: GObject.ParamSpec) => void;
                'notify::decoder': (pspec: GObject.ParamSpec) => void;
                'notify::joiner': (pspec: GObject.ParamSpec) => void;
                'notify::tokens': (pspec: GObject.ParamSpec) => void;
                'notify::model-type': (pspec: GObject.ParamSpec) => void;
                'notify::provider': (pspec: GObject.ParamSpec) => void;
                'notify::num-threads': (pspec: GObject.ParamSpec) => void;
                'notify::decoding-method': (pspec: GObject.ParamSpec) => void;
                'notify::max-active-paths': (pspec: GObject.ParamSpec) => void;
                'notify::hotwords-score': (pspec: GObject.ParamSpec) => void;
                'notify::blank-penalty': (pspec: GObject.ParamSpec) => void;
                'notify::sample-rate': (pspec: GObject.ParamSpec) => void;
                'notify::feature-dim': (pspec: GObject.ParamSpec) => void;
                'notify::enable-debug': (pspec: GObject.ParamSpec) => void;
                'notify::is-open': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface
            interface ConstructorProps extends GObject.Object.ConstructorProps {
                encoder: string;
                decoder: string;
                joiner: string;
                tokens: string;
                model_type: string | null;
                modelType: string;
                provider: string;
                num_threads: number;
                numThreads: number;
                decoding_method: string;
                decodingMethod: string;
                max_active_paths: number;
                maxActivePaths: number;
                hotwords_score: number;
                hotwordsScore: number;
                blank_penalty: number;
                blankPenalty: number;
                sample_rate: number;
                sampleRate: number;
                feature_dim: number;
                featureDim: number;
                enable_debug: boolean;
                enableDebug: boolean;
                is_open: boolean;
                isOpen: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class OfflineRecognizer extends GObject.Object {
            static $gtype: GObject.GType<OfflineRecognizer>;

            // Properties
            /**
             * @construct-only
             */
            get encoder(): string;

            /**
             * @construct-only
             */
            get decoder(): string;

            /**
             * @construct-only
             */
            get joiner(): string;

            /**
             * @construct-only
             */
            get tokens(): string;

            get model_type(): string | null;
            set model_type(val: string | null);

            get modelType(): string;
            set modelType(val: string);

            get provider(): string;
            set provider(val: string);

            get num_threads(): number;
            set num_threads(val: number);

            get numThreads(): number;
            set numThreads(val: number);

            get decoding_method(): string;
            set decoding_method(val: string);

            get decodingMethod(): string;
            set decodingMethod(val: string);

            get max_active_paths(): number;
            set max_active_paths(val: number);

            get maxActivePaths(): number;
            set maxActivePaths(val: number);

            get hotwords_score(): number;
            set hotwords_score(val: number);

            get hotwordsScore(): number;
            set hotwordsScore(val: number);

            get blank_penalty(): number;
            set blank_penalty(val: number);

            get blankPenalty(): number;
            set blankPenalty(val: number);

            get sample_rate(): number;
            set sample_rate(val: number);

            get sampleRate(): number;
            set sampleRate(val: number);

            get feature_dim(): number;
            set feature_dim(val: number);

            get featureDim(): number;
            set featureDim(val: number);

            get enable_debug(): boolean;
            set enable_debug(val: boolean);

            get enableDebug(): boolean;
            set enableDebug(val: boolean);

            /**
             * @read-only
             */
            get is_open(): boolean;

            /**
             * @read-only
             */
            get isOpen(): boolean;

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: OfflineRecognizer.SignalSignatures;

            // Constructors
            constructor(properties?: Partial<OfflineRecognizer.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            static ['new'](encoder: string, decoder: string, joiner: string, tokens: string): OfflineRecognizer;

            // Signals
            /** @signal */
            connect<K extends keyof OfflineRecognizer.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OfflineRecognizer.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            connect_after<K extends keyof OfflineRecognizer.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OfflineRecognizer.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            emit<K extends keyof OfflineRecognizer.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<OfflineRecognizer.SignalSignatures[K]> extends [any, ...infer Q]
                    ? Q
                    : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods
            open(): void;

            close(): void;

            /**
             * @param hotwords
             */
            create_stream(hotwords: string | null): OfflineStream;

            get_encoder(): string;

            get_decoder(): string;

            get_joiner(): string;

            get_tokens(): string;

            get_model_type(): string | null;

            /**
             * @param value
             */
            set_model_type(value: string | null): void;

            get_provider(): string;

            /**
             * @param value
             */
            set_provider(value: string): void;

            get_num_threads(): number;

            /**
             * @param value
             */
            set_num_threads(value: number): void;

            get_decoding_method(): string;

            /**
             * @param value
             */
            set_decoding_method(value: string): void;

            get_max_active_paths(): number;

            /**
             * @param value
             */
            set_max_active_paths(value: number): void;

            get_hotwords_score(): number;

            /**
             * @param value
             */
            set_hotwords_score(value: number): void;

            get_blank_penalty(): number;

            /**
             * @param value
             */
            set_blank_penalty(value: number): void;

            get_sample_rate(): number;

            /**
             * @param value
             */
            set_sample_rate(value: number): void;

            get_feature_dim(): number;

            /**
             * @param value
             */
            set_feature_dim(value: number): void;

            get_enable_debug(): boolean;

            /**
             * @param value
             */
            set_enable_debug(value: boolean): void;

            get_is_open(): boolean;
        }

        namespace OfflineStream {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                'notify::is-open': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface
            interface ConstructorProps extends GObject.Object.ConstructorProps {
                is_open: boolean;
                isOpen: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class OfflineStream extends GObject.Object {
            static $gtype: GObject.GType<OfflineStream>;

            // Properties
            /**
             * @read-only
             */
            get is_open(): boolean;

            /**
             * @read-only
             */
            get isOpen(): boolean;

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: OfflineStream.SignalSignatures;

            // Constructors
            constructor(properties?: Partial<OfflineStream.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            // Signals
            /** @signal */
            connect<K extends keyof OfflineStream.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OfflineStream.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            connect_after<K extends keyof OfflineStream.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, OfflineStream.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            emit<K extends keyof OfflineStream.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<OfflineStream.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods
            close(): void;

            /**
             * @param sample_rate
             * @param samples
             */
            accept(sample_rate: number, samples: number[]): void;

            decode(): void;

            get_text(): string;

            get_json(): string;

            get_is_open(): boolean;
        }

        /**
         * @gir-type Alias
         */
        type VadClass = typeof Vad;

        /**
         * @gir-type Struct
         */
        abstract class VadPrivate {
            static $gtype: GObject.GType<VadPrivate>;
        }

        /**
         * @gir-type Alias
         */
        type OnlineRecognizerClass = typeof OnlineRecognizer;

        /**
         * @gir-type Struct
         */
        abstract class OnlineRecognizerPrivate {
            static $gtype: GObject.GType<OnlineRecognizerPrivate>;
        }

        /**
         * @gir-type Alias
         */
        type OnlineStreamClass = typeof OnlineStream;

        /**
         * @gir-type Struct
         */
        abstract class OnlineStreamPrivate {
            static $gtype: GObject.GType<OnlineStreamPrivate>;
        }

        /**
         * @gir-type Alias
         */
        type OfflineRecognizerClass = typeof OfflineRecognizer;

        /**
         * @gir-type Struct
         */
        abstract class OfflineRecognizerPrivate {
            static $gtype: GObject.GType<OfflineRecognizerPrivate>;
        }

        /**
         * @gir-type Alias
         */
        type OfflineStreamClass = typeof OfflineStream;

        /**
         * @gir-type Struct
         */
        abstract class OfflineStreamPrivate {
            static $gtype: GObject.GType<OfflineStreamPrivate>;
        }

        /**
         * Name of the imported GIR library
         * `see` https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L188
         */
        const __name__: string;

        /**
         * Version of the imported GIR library
         * `see` https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L189
         */
        const __version__: string;
    }

    export default GjsifySherpa;
}

declare module 'gi://GjsifySherpa' {
    import GjsifySherpa10 from 'gi://GjsifySherpa?version=1.0';
    export default GjsifySherpa10;
}
// END
