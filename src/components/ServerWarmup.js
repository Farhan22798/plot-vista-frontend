import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import api from '../services/api';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SHOW_UI_DELAY_MS = 3000;

const ServerWarmup = ({ children }) => {
  const [isWarmedUp, setIsWarmedUp] = useState(false);
  const [showUI, setShowUI] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  
  const animatedValue = useRef(new Animated.Value(60)).current;

  useEffect(() => {
    let pingInterval = null;
    let cancelled = false;

    const checkServer = async () => {
      if (cancelled) return;
      try {
        if (__DEV__) {
          console.log('[ServerWarmup] Pinging server...');
        }
        await api.get('/summary');
        if (cancelled) return;
        if (__DEV__) {
          console.log('[ServerWarmup] Server-ready; stopping ping loop');
        }
        if (pingInterval != null) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        setIsWarmedUp(true);
      } catch (error) {
        if (__DEV__) {
          console.log('[ServerWarmup] Server asleep or unavailable. Retrying in 3s…');
        }
      }
    };

    checkServer();
    pingInterval = setInterval(checkServer, 3000);

    // Only show the warmup UI if the server hasn't responded within 3s.
    const uiTimer = setTimeout(() => {
      if (!cancelled) setShowUI(true);
    }, SHOW_UI_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(uiTimer);
      if (pingInterval != null) {
        clearInterval(pingInterval);
      }
    };
  }, []);

  useEffect(() => {
    if (isWarmedUp || !showUI) return;

    if (timeLeft > 0) {
      Animated.timing(animatedValue, {
        toValue: timeLeft - 1,
        duration: 1000,
        useNativeDriver: true,
      }).start();

      const timerId = setTimeout(() => {
        setTimeLeft(timeLeft - 1);
      }, 1000);

      return () => clearTimeout(timerId);
    } else {
      setIsWarmedUp(true);
    }
  }, [timeLeft, isWarmedUp, showUI]);

  if (isWarmedUp) {
    return <>{children}</>;
  }

  if (!showUI) {
    return null;
  }

  const radius = 100;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;
  
  // Calculate dash offset logically for the Animated View
  // We go from 60 to 0. 
  // At 60 (start), offset should be 0 (full circle).
  // At 0 (end), offset should be max (circumference).
  // Formula: circumference - (AnimatedValue / 60) * circumference
  const strokeDashoffset = animatedValue.interpolate({
    inputRange: [0, 60],
    outputRange: [circumference, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        
        <View style={styles.svgWrapper}>
          <Svg height={radius * 2 + strokeWidth} width={radius * 2 + strokeWidth}>
            {/* Background Circle */}
            <Circle
              cx={(radius * 2 + strokeWidth) / 2}
              cy={(radius * 2 + strokeWidth) / 2}
              r={radius}
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth={strokeWidth}
              fill="none"
            />
            {/* Animated Progress Circle */}
            <AnimatedCircle
              cx={(radius * 2 + strokeWidth) / 2}
              cy={(radius * 2 + strokeWidth) / 2}
              r={radius}
              stroke="#2A9D8F"
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              rotation="-90"
              origin={`${(radius * 2 + strokeWidth) / 2}, ${(radius * 2 + strokeWidth) / 2}`}
            />
          </Svg>
          <View style={styles.timerTextContainer}>
            <Text style={styles.timerText}>{timeLeft}</Text>
            <Text style={styles.secText}>sec</Text>
          </View>
        </View>

        <Text style={styles.title}>Establishing Connection</Text>
        <Text style={styles.subtitle}>
          Waking up secure backend. Please wait...
        </Text>
        
        <View style={styles.indicatorRow}>
          <ActivityIndicator size="small" color="#2A9D8F" />
          <Text style={styles.pingingText}>Pinging remote servers</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a', // Very modern dark slate shade
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 24,
  },
  svgWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  timerTextContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerText: {
    fontSize: 52,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 60,
  },
  secText: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  pingingText: {
    color: '#cbd5e1',
    marginLeft: 12,
    fontSize: 14,
    fontWeight: '500',
  },
});

export default ServerWarmup;
