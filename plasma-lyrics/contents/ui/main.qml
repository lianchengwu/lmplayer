import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15

import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.workspace.dbus 1.0 as DBus

PlasmoidItem {
    id: root
    preferredRepresentation: fullRepresentation

    property string currentLyrics: "wmPlayer"
    property string songName: ""
    property string artist: ""
    property bool isConnected: serviceWatcher.registered
    property bool isKrcFormat: false

    // 卡拉OK相关属性
    property var karaokeChars: []
    property var karaokeTimings: []
    property int currentCharIndex: 0
    property real startTime: 0
    property bool karaokeActive: false

    // 主题颜色属性
    readonly property color textColor: PlasmaCore.Theme.textColor
    readonly property color highlightColor: PlasmaCore.Theme.highlightColor

    // D-Bus服务监测：监控 wmPlayer 是否正在运行
    DBus.DBusServiceWatcher {
        id: serviceWatcher
        busType: DBus.BusType.Session
        watchedService: "org.wmplayer.Lyric"

        onRegisteredChanged: {
            if (!registered) {
                currentLyrics = "wmPlayer 未启动"
                resetKaraoke()
            } else {
                currentLyrics = "wmPlayer 已就绪"
            }
        }
    }

    // D-Bus信号监听器：实时接收歌词更新广播
    DBus.SignalWatcher {
        id: lyricSignalWatcher
        enabled: root.isConnected
        busType: DBus.BusType.Session
        service: "org.wmplayer.Lyric"
        path: "/org/wmplayer/Lyric"
        iface: "org.wmplayer.Lyric"

        onReceivedSignal: function(message) {
            if (message.member === "LyricUpdated") {
                var args = message.arguments
                handleLyricsUpdate({
                    songName: args[0] || "",
                    artist: args[1] || "",
                    text: args[2] || "",
                    format: args[3] || "lrc"
                })
            }
        }
    }

    // D-Bus属性同步
    DBus.Properties {
        id: lyricProps
        busType: DBus.BusType.Session
        service: "org.wmplayer.Lyric"
        path: "/org/wmplayer/Lyric"
        iface: "org.wmplayer.Lyric"

        onPropertiesChanged: function(interfaceName, changedProps, invalidatedProps) {
            if (changedProps.lyric !== undefined) {
                handleLyricsUpdate({
                    songName: changedProps.song_name !== undefined ? changedProps.song_name : (lyricProps.properties.song_name || ""),
                    artist: changedProps.artist !== undefined ? changedProps.artist : (lyricProps.properties.artist || ""),
                    text: changedProps.lyric || "",
                    format: changedProps.format !== undefined ? changedProps.format : (lyricProps.properties.format || "lrc")
                })
            }
        }
    }

    // 调用 D-Bus 方法反向控制播放器
    function callDbus(method) {
        DBus.SessionBus.asyncCall({
            service: "org.wmplayer.Lyric",
            path: "/org/wmplayer/Lyric",
            iface: "org.wmplayer.Lyric",
            member: method,
            arguments: []
        })
    }

    fullRepresentation: Item {
        Layout.preferredWidth: Math.max(180, lyricsContainer.implicitWidth + 36)
        Layout.preferredHeight: Math.max(32, lyricsContainer.implicitHeight + 10)

        // 鼠标点击播控支持
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            acceptedButtons: Qt.LeftButton | Qt.MiddleButton

            // 单击播放/暂停，中键切换桌面歌词
            onClicked: function(mouse) {
                if (mouse.button === Qt.LeftButton) {
                    callDbus("TogglePlayPause")
                } else if (mouse.button === Qt.MiddleButton) {
                    callDbus("ToggleOSD")
                }
            }

            // 滚轮切歌
            onWheel: function(wheel) {
                if (wheel.angleDelta.y > 0) {
                    callDbus("Previous")
                } else {
                    callDbus("Next")
                }
            }

            ToolTip.visible: containsMouse
            ToolTip.text: root.isConnected ?
                (songName ? (songName + " - " + artist + "\n左键: 播放/暂停 | 滚轮: 切歌 | 中键: 桌面歌词") : "wmPlayer 播放器\n左键: 播放/暂停") :
                "wmPlayer 未连接"
        }

        // 歌词显示区域
        ScrollView {
            id: lyricsContainer
            anchors.left: parent.left
            anchors.right: statusIndicator.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.leftMargin: 4
            anchors.rightMargin: 4

            ScrollBar.horizontal.policy: ScrollBar.AsNeeded
            ScrollBar.vertical.policy: ScrollBar.AlwaysOff

            contentWidth: isKrcFormat ? karaokeWrapper.width : lyricsWrapper.width
            contentHeight: height

            property real implicitWidth: isKrcFormat ? karaokeRow.implicitWidth : lyricsWrapper.implicitWidth
            property real implicitHeight: isKrcFormat ? karaokeRow.implicitHeight : lyricsWrapper.implicitHeight

            // 普通 LRC 歌词
            Item {
                id: lyricsWrapper
                width: Math.max(lyricsContainer.width, lyricLabel.implicitWidth)
                height: lyricsContainer.height
                visible: !isKrcFormat

                property real implicitWidth: lyricLabel.implicitWidth
                property real implicitHeight: lyricLabel.implicitHeight

                Label {
                    id: lyricLabel
                    text: currentLyrics
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    verticalAlignment: Text.AlignVCenter
                    horizontalAlignment: Text.AlignRight
                    color: root.isConnected ? textColor : PlasmaCore.ColorScope.disabledTextColor
                    font.bold: true
                    font.pointSize: PlasmaCore.Theme.defaultFont.pointSize
                    wrapMode: Text.NoWrap
                }
            }

            // KRC 卡拉OK歌词（逐字动画）
            Item {
                id: karaokeWrapper
                width: Math.max(lyricsContainer.width, karaokeRow.implicitWidth)
                height: lyricsContainer.height
                visible: isKrcFormat

                Row {
                    id: karaokeRow
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    spacing: 0
                    width: implicitWidth

                    Repeater {
                        id: karaokeRepeater
                        model: karaokeChars

                        Label {
                            text: modelData.char
                            color: modelData.highlighted ? highlightColor : textColor
                            font.bold: true
                            font.pointSize: PlasmaCore.Theme.defaultFont.pointSize

                            Behavior on color {
                                ColorAnimation { duration: 120; easing.type: Easing.OutQuad }
                            }

                            transform: Scale {
                                origin.x: width / 2
                                origin.y: height / 2
                                xScale: modelData.highlighted ? 1.08 : 1.0
                                yScale: modelData.highlighted ? 1.08 : 1.0
                                Behavior on xScale { NumberAnimation { duration: 120 } }
                                Behavior on yScale { NumberAnimation { duration: 120 } }
                            }
                        }
                    }
                }
            }
        }

        // 状态指示器
        Rectangle {
            id: statusIndicator
            width: 7
            height: 7
            radius: 3.5
            color: root.isConnected ? "#10b981" : "#ef4444"
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            anchors.margins: 4
            opacity: 0.85
        }
    }

    // 卡拉OK高亮定时器
    Timer {
        id: karaokeTimer
        interval: 50 // 50ms 刷新
        repeat: true
        running: karaokeActive && isKrcFormat
        onTriggered: {
            updateKaraokeHighlight()
        }
    }

    function handleLyricsUpdate(eventData) {
        songName = eventData.songName || ""
        artist = eventData.artist || ""
        var format = eventData.format || "lrc"
        var text = eventData.text || ""

        if (!text || text.trim() === "") {
            currentLyrics = songName ? (songName + " - " + artist) : "wmPlayer"
            resetKaraoke()
            return
        }

        if (format === "krc" || (text.indexOf("]<") !== -1 && text.indexOf(">") !== -1)) {
            isKrcFormat = true
            processKrcLyrics(text)
        } else {
            isKrcFormat = false
            processLrcLyrics(text)
        }
    }

    // 解析 KRC 逐字时间信息
    function processKrcLyrics(krcText) {
        var timeMatch = krcText.match(/\[(\d+),(\d+)\]/)
        if (!timeMatch) {
            currentLyrics = krcText.replace(/<[\d,]+>/g, '').trim()
            resetKaraoke()
            return
        }

        var remainingText = krcText.replace(/\[[\d,]+\]/, '')
        var timeMarkPattern = /<(\d+),(\d+),\d+>/g
        var timeMarks = []
        var match

        while ((match = timeMarkPattern.exec(remainingText)) !== null) {
            timeMarks.push({
                startTime: parseInt(match[1]),
                duration: parseInt(match[2]),
                markEnd: match.index + match[0].length,
                markStart: match.index
            })
        }

        var chars = []
        var timings = []

        for (var i = 0; i < timeMarks.length; i++) {
            var tm = timeMarks[i]
            var nextStart = (i + 1 < timeMarks.length) ? timeMarks[i + 1].markStart : remainingText.length
            var segment = remainingText.substring(tm.markEnd, nextStart)

            for (var j = 0; j < segment.length; j++) {
                chars.push({
                    char: segment.charAt(j),
                    highlighted: false
                })
                timings.push({
                    startTime: tm.startTime,
                    duration: tm.duration
                })
            }
        }

        if (chars.length > 0) {
            karaokeChars = chars
            karaokeTimings = timings
            startTime = Date.now()
            currentCharIndex = 0
            karaokeActive = true
        } else {
            currentLyrics = krcText.replace(/<[\d,]+>/g, '').trim()
            resetKaraoke()
        }
    }

    // 解析普通 LRC 歌词
    function processLrcLyrics(lrcText) {
        resetKaraoke()
        var clean = lrcText.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim()
        currentLyrics = clean || "♪ 音乐播放中 ♪"
    }

    // 更新卡拉OK高亮状态
    function updateKaraokeHighlight() {
        if (!karaokeActive || karaokeChars.length === 0) return

        var elapsed = Date.now() - startTime
        var updated = false

        for (var i = 0; i < karaokeTimings.length; i++) {
            var shouldHighlight = elapsed >= karaokeTimings[i].startTime
            if (karaokeChars[i].highlighted !== shouldHighlight) {
                karaokeChars[i].highlighted = shouldHighlight
                updated = true
            }
        }

        if (updated) {
            karaokeRepeater.model = []
            karaokeRepeater.model = karaokeChars
        }
    }

    function resetKaraoke() {
        karaokeActive = false
        karaokeChars = []
        karaokeTimings = []
        currentCharIndex = 0
    }
}
