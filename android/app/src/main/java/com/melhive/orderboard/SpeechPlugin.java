package com.melhive.orderboard;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;

/**
 * Android speech recognition with live captions.
 *
 * start() begins one utterance and resolves with its session id. Everything
 * after that arrives as events, each tagged with that id:
 *   "partial" {text}  - the words so far, while the person is talking
 *   "final"   {text}  - the finished sentence
 *   "error"   {error} - no-speech | not-allowed | network | language | other
 *   "end"     {}      - always last, after "final" or "error"
 *   "level"   {level} - microphone loudness 0..1, about 15 times a second
 * abort() drops the session silently; stop() ends it early and still
 * delivers "final". Events from an older session are never sent.
 * (src/platform/voice.ts is the only caller.)
 */
@CapacitorPlugin(name = "Speech", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") })
public class SpeechPlugin extends Plugin {

    private SpeechRecognizer recognizer;
    /** Current session id; only touched on the main thread. */
    private int session = 0;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("not-allowed");
            return;
        }
        final String language = call.getString("language", "en-PH");
        final boolean preferOffline = Boolean.TRUE.equals(call.getBoolean("preferOffline", false));
        getActivity()
            .runOnUiThread(() -> {
                try {
                    destroyRecognizer();
                    final int id = ++session;
                    recognizer = SpeechRecognizer.createSpeechRecognizer(getActivity());
                    recognizer.setRecognitionListener(new Listener(id));
                    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                    intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                    intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getActivity().getPackageName());
                    if (preferOffline) intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                    // Hints to end the sentence after a short pause (many recognizers honour them).
                    intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
                    intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L);
                    recognizer.startListening(intent);
                    JSObject r = new JSObject();
                    r.put("id", id);
                    call.resolve(r);
                } catch (Exception e) {
                    call.reject("other", e);
                }
            });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                try {
                    if (recognizer != null) recognizer.stopListening();
                } catch (Exception ignored) {}
                call.resolve();
            });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                session++;
                destroyRecognizer();
                call.resolve();
            });
    }

    @Override
    protected void handleOnDestroy() {
        session++;
        destroyRecognizer();
    }

    private void destroyRecognizer() {
        if (recognizer == null) return;
        try {
            recognizer.cancel();
            recognizer.destroy();
        } catch (Exception ignored) {}
        recognizer = null;
    }

    private static String errorName(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
                return "network";
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED (API 31)
            case 13: // ERROR_LANGUAGE_UNAVAILABLE (API 31)
                return "language";
            default:
                return "other";
        }
    }

    private class Listener implements RecognitionListener {

        private final int id;
        private long lastLevelAt = 0;
        private float smoothed = 0;

        Listener(int id) {
            this.id = id;
        }

        private void send(String event, JSObject data) {
            if (id != session) return; // an older, replaced session
            data.put("id", id);
            notifyListeners(event, data);
        }

        private String best(Bundle b) {
            ArrayList<String> m = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (m == null || m.isEmpty() || m.get(0) == null) return "";
            return m.get(0);
        }

        @Override
        public void onReadyForSpeech(Bundle params) {}

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {
            // rmsdB is roughly -2 (silence) to 10 (loud); send 0..1, throttled.
            float v = Math.max(0f, Math.min(1f, (rmsdB + 2f) / 12f));
            smoothed = smoothed * 0.5f + v * 0.5f;
            long now = System.currentTimeMillis();
            if (now - lastLevelAt < 66) return;
            lastLevelAt = now;
            JSObject d = new JSObject();
            d.put("level", (double) smoothed);
            send("level", d);
        }

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {}

        @Override
        public void onError(int code) {
            JSObject d = new JSObject();
            d.put("error", errorName(code));
            d.put("code", code);
            send("error", d);
            send("end", new JSObject());
        }

        @Override
        public void onResults(Bundle results) {
            JSObject d = new JSObject();
            d.put("text", best(results));
            send("final", d);
            send("end", new JSObject());
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            String t = best(partialResults);
            if (t.isEmpty()) return;
            JSObject d = new JSObject();
            d.put("text", t);
            send("partial", d);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    }
}
