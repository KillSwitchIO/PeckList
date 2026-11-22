package com.pecklist.app;

import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** {@link NativeStoreCases} in the JVM: Robolectric runs the real SQLiteOpenHelper on its bundled SQLite. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class NativeStoreTest extends NativeStoreCases {
}
