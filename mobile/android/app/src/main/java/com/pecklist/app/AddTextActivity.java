package com.pecklist.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import java.util.ArrayList;
import java.util.Locale;

/**
 * A new task from outside the app (PL-113), unseen, closing at once: text shared to PeckList
 * (ACTION_SEND), "Add to PeckList" on selected text (ACTION_PROCESS_TEXT), the documented
 * add-from-text intent (ACTION_ADD_TEXT with EXTRA_TEXT), or speech (ACTION_VOICE: the long-press
 * shortcut, the Quick Settings tile, the add-task bar widget's microphone), through the phone's own
 * speech recognizer, which needs no Google Play services. Each opens Today with the add field
 * holding the text (AddText), for the person to check and add; nothing is added on its own.
 */
public class AddTextActivity extends Activity {

    static final String ACTION_ADD_TEXT = "com.pecklist.app.ADD_TEXT";
    static final String ACTION_VOICE = "com.pecklist.app.VOICE_ADD";
    private static final int SPEECH = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) return; // Back from the recognizer after a restart: onActivityResult follows.
        Intent intent = getIntent();
        String action = intent == null ? null : intent.getAction();
        if (ACTION_VOICE.equals(action)) {
            listen();
            return;
        }
        CharSequence text = null;
        if (Intent.ACTION_SEND.equals(action)) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text == null) text = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        } else if (ACTION_ADD_TEXT.equals(action)) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        }
        openAdd(AddText.clean(text));
    }

    /** The phone's speech recognizer; with none, the add field with the keyboard (Gboard's own microphone is there). */
    private void listen() {
        Intent speech = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_prompt))
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(speech, SPEECH);
        } catch (ActivityNotFoundException | SecurityException none) {
            openAdd(null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SPEECH) return;
        ArrayList<String> heard = resultCode == RESULT_OK && data != null
            ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        if (heard == null || heard.isEmpty()) {
            finishQuietly(); // Backed out of the recognizer: nothing to add.
            return;
        }
        openAdd(AddText.clean(heard.get(0)));
    }

    /** Today with the add field focused, holding `text` when there is some. */
    private void openAdd(String text) {
        if (text != null) AddText.put(text, System.currentTimeMillis());
        startActivity(new Intent(Shortcuts.ACTION, Uri.parse(Shortcuts.SCHEME + ":/today?add=1"), this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finishQuietly();
    }

    private void finishQuietly() {
        finish();
        overridePendingTransition(0, 0);
    }
}
