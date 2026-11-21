package com.pecklist.app;

import android.app.Application;
import android.content.res.Configuration;

/**
 * The app's process. Only for the language (PL-148): below Android 13 it puts the language picked
 * in the app back at every start and after every configuration change (which resets it), and on any
 * version it redraws channel names and widgets when the languages change.
 */
public class PeckListApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        Languages.restore(this);
        Languages.noteDrawn(this);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        Languages.restore(this);
        Languages.redrawIfChanged(this);
    }
}
