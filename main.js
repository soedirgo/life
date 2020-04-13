/*
 * TODO:
 * - remember settings in the hash or offer link
 * - life 1.05 is currently broken
 * - better mobile handling: allow drawing
 * - jump to coordinate
 * - make screenshots, maybe gifs
 * - allow people to upload patterns
 * - maybe more than 2 states (non-life)
 * - fail-safe http requests and pattern parsing
 * - restore meta life
 * - error when zooming while pattern is loading
 * - run http://copy.sh/life/?pattern=demonoid_synth without crashing (improve memory efficiency)
 * - some patterns break randomly (hard to reproduce, probably related to speed changing)
 */

"use strict";


var
    /** @const */
    DEFAULT_BORDER = 0.25,
    /** @const */
    DEFAULT_FPS = 60;


(function()
{
    var

        /**
         * which pattern file is currently loaded
         * @type {{title: String, urls, comment, view_url, source_url}}
         * */
        current_pattern,

        // functions which is called when the pattern stops running
        /** @type {function()|undefined} */
        onstop,

        last_mouse_x,
        last_mouse_y,

        mouse_set,

        // is the game running ?
        /** @type {boolean} */
        running = false,
        mouse_down = false,

        /** @type {number} */
        max_fps,

        // has the pattern list been loaded
        /** @type {boolean} */
        patterns_loaded = false,

        /**
         * path to the folder with all patterns
         * @const
         */
        pattern_path = "examples/",

        loaded = false,


        life = new LifeUniverse(),
        drawer = new LifeCanvasDrawer(),

        // example setups which are run at startup
        // loaded from examples/
        /** @type {Array.<string>} */
        examples = (
            "soedirgo,"
        ).split("|");



    /** @type {function(function())} */
    var nextFrame =
        window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        setTimeout;

    // setup
    function onload()
    {
        if(loaded)
        {
            // onload has been called already
            return;
        }

        loaded = true;

        drawer.init(document.body)

        init_ui();

        drawer.set_size(window.innerWidth, document.body.offsetHeight);
        reset_settings();

        // This gets called, when a pattern is loaded.
        // It has to be called at least once before anything can happen.
        // Since we always load a pattern, it's not necessary at this point.
        //life.clear_pattern();

        // production setup
        // loads a pattern defined by ?pattern=filename (without extension)
        // or a random small pattern instead

        load_random();

        function load_random()
        {
            var random_pattern = examples[Math.random() * examples.length | 0].split(",")[0];

            http_get(
                rle_link(random_pattern),
                function(text) {
                    setup_pattern(text, random_pattern);
                }
            );
        }


        function init_ui()
        {
            show_element($("toolbar"));

            var style_element = document.createElement("style");
            document.head.appendChild(style_element);

            window.onresize = debounce(function()
            {
                drawer.set_size(window.innerWidth, document.body.offsetHeight);

                requestAnimationFrame(lazy_redraw.bind(0, life.root));
            }, 500);

            $("gen_step").onchange = function(e)
            {
                if(this.type === "number")
                {
                    var value = Number(this.value);

                    if(!value)
                    {
                        return;
                    }

                    var closest_pow2 = Math.pow(2, Math.round(Math.log(value) / Math.LN2));
                    if(value <= 1)
                    {
                        this.value = 1;
                    }
                    else
                    {
                        this.value = closest_pow2;
                    }

                    this.step = this.value / 2;
                }
            };

            $("run_button").onclick = function()
            {
                if(running)
                {
                    stop();
                }
                else
                {
                    run();
                }
            };

            $("step_button").onclick = function()
            {
                if(!running)
                {
                    step(true);
                }
            };

            $("rewind_button").onclick = function()
            {
                if(life.rewind_state)
                {
                    stop(function()
                    {
                        life.restore_rewind_state();

                        fit_pattern();
                        drawer.redraw(life.root);
                    });
                }
            };

            drawer.canvas.onmousedown = function(e)
            {
                if(e.which === 1)
                {
                    if(drawer.cell_width >= 1) // only at reasonable zoom levels
                    {
                        mouse_down = true;

                        var coords = drawer.pixel2cell(e.clientX, e.clientY);

                        mouse_set = !life.get_bit(coords.x, coords.y);

                        window.addEventListener("mousemove", do_field_draw, true);
                        do_field_draw(e);
                    }
                }
                else if(e.which === 2 || e.which === 3)
                {
                    last_mouse_x = e.clientX;
                    last_mouse_y = e.clientY;
                    //console.log("start", e.clientX, e.clientY);

                    window.addEventListener("mousemove", do_field_move, true);

                    (function redraw()
                    {
                        if(last_mouse_x !== null)
                        {
                            requestAnimationFrame(redraw);
                        }

                        lazy_redraw(life.root);
                    })();
                }

                return false;
            };

            var scaling = false;
            var last_distance = 0;

            function distance(touches)
            {
                console.assert(touches.length >= 2);

                return Math.sqrt(
                    (touches[0].clientX-touches[1].clientX) * (touches[0].clientX-touches[1].clientX) +
                    (touches[0].clientY-touches[1].clientY) * (touches[0].clientY-touches[1].clientY));
            }

            drawer.canvas.addEventListener("touchstart", function(e)
            {
                if(e.touches.length === 2)
                {
                    scaling = true;
                    last_distance = distance(e.touches);
                    e.preventDefault();
                }
                else if(e.touches.length === 1)
                {
                    // left mouse simulation
                    var ev = {
                        which: 1,
                        clientX: e.changedTouches[0].clientX,
                        clientY: e.changedTouches[0].clientY,
                    };

                    drawer.canvas.onmousedown(ev);

                    e.preventDefault();
                }
            }, false);

            drawer.canvas.addEventListener("touchmove", function(e)
            {
                if(scaling)
                {
                    let new_distance = distance(e.touches);
                    let changed = false;
                    const MIN_DISTANCE = 50;

                    while(last_distance - new_distance > MIN_DISTANCE)
                    {
                        last_distance -= MIN_DISTANCE;
                        drawer.zoom_centered(true);
                        changed = true;
                    }

                    while(last_distance - new_distance < -MIN_DISTANCE)
                    {
                        last_distance += MIN_DISTANCE;
                        drawer.zoom_centered(false);
                        changed = true;
                    }

                    if(changed)
                    {
                        lazy_redraw(life.root);
                    }
                }
                else
                {
                    var ev = {
                        clientX: e.changedTouches[0].clientX,
                        clientY: e.changedTouches[0].clientY,
                    };

                    do_field_draw(ev);

                    e.preventDefault();
                }
            }, false);

            drawer.canvas.addEventListener("touchend", function(e)
            {
                window.removeEventListener("touchmove", do_field_draw, true);
                window.onmouseup(e);
                e.preventDefault();
                scaling = false;
            }, false);

            drawer.canvas.addEventListener("touchcancel", function(e)
            {
                window.removeEventListener("touchmove", do_field_draw, true);
                window.onmouseup(e);
                e.preventDefault();
                scaling = false;
            }, false);

            window.onmouseup = function(e)
            {
                last_mouse_x = null;
                last_mouse_y = null;

                window.removeEventListener("mousemove", do_field_draw, true);
                window.removeEventListener("mousemove", do_field_move, true);

                mouse_down = false;
            };

            drawer.canvas.oncontextmenu = function(e)
            {
                return false;
            };

            drawer.canvas.onmousewheel = function(e)
            {
                e.preventDefault();
                drawer.zoom_at((e.wheelDelta || -e.detail) < 0, e.clientX, e.clientY);

                lazy_redraw(life.root);
                return false;
            };

            drawer.canvas.addEventListener("DOMMouseScroll", drawer.canvas.onmousewheel, false);

            window.onkeydown = function(e)
            {
                var chr = e.which,
                    do_redraw = false,
                    target = e.target.nodeName;

                //console.log(e.target)
                //console.log(chr + " " + e.charCode + " " + e.keyCode);

                if(target === "INPUT" || target === "TEXTAREA")
                {
                    return true;
                }

                if(e.ctrlKey || e.shiftKey || e.altKey)
                {
                    return true;
                }

                if(chr === 37 || chr === 72)
                {
                    drawer.move(15, 0);
                    do_redraw = true;
                }
                else if(chr === 38 || chr === 75)
                {
                    drawer.move(0, 15);
                    do_redraw = true;
                }
                else if(chr === 39 || chr === 76)
                {
                    drawer.move(-15, 0);
                    do_redraw = true;
                }
                else if(chr === 40 || chr === 74)
                {
                    drawer.move(0, -15);
                    do_redraw = true;
                }
                else if(chr === 27)
                {
                    // escape
                    return false;
                }
                else if(chr === 13)
                {
                    // enter
                    $("run_button").onclick();
                    return false;
                }
                else if(chr === 32)
                {
                    // space
                    $("step_button").onclick();
                    return false;
                }
                else if(chr === 189 || chr === 173 || chr === 109)
                {
                    // -
                    drawer.zoom_centered(true);
                    do_redraw = true;
                }
                else if(chr === 187 || chr === 61)
                {
                    // + and =
                    drawer.zoom_centered(false);
                    do_redraw = true;
                }
                else if(chr === 8)
                {
                    // backspace
                    $("rewind_button").onclick();
                    return false;
                }
                else if(chr === 219 || chr === 221)
                {
                    // [ ]
                    var step = life.step;

                    if(chr === 219)
                        step--;
                    else
                        step++;

                    if(step >= 0)
                    {
                        life.set_step(step);
                    }

                    return false;
                }

                if(do_redraw)
                {
                    lazy_redraw(life.root);

                    return false;
                }

                return true;
            };

            $("faster_button").onclick = function()
            {
                var step = life.step + 1;

                life.set_step(step);
            };

            $("slower_button").onclick = function()
            {
                if(life.step > 0)
                {
                    var step = life.step - 1;

                    life.set_step(step);
                }
            };

            $("normalspeed_button").onclick = function()
            {
                life.set_step(0);
            };

            $("zoomin_button").onclick = function()
            {
                drawer.zoom_centered(false);
                lazy_redraw(life.root);
            };

            $("zoomout_button").onclick = function()
            {
                drawer.zoom_centered(true);
                lazy_redraw(life.root);
            };

            $("initial_pos_button").onclick = function()
            {
                fit_pattern();
                lazy_redraw(life.root);
            };

            $("middle_button").onclick = function()
            {
                drawer.center_view();
                lazy_redraw(life.root);
            };

            var positions = [
                ["ne",  1, -1],
                ["nw", -1, -1],
                ["se",  1,  1],
                ["sw", -1,  1],
                ["n",   0, -1],
                ["e",  -1,  0],
                ["s",   0,  1],
                ["w",   1,  0],
            ];

            for(var i = 0; i < positions.length; i++)
            {
                var node = document.getElementById(positions[i][0] + "_button");

                node.onclick = (function(info)
                {
                    return function()
                    {
                        drawer.move(info[1] * -30, info[2] * -30);
                        lazy_redraw(life.root);
                    };
                })(positions[i]);

            }
        }
    };

    document.addEventListener("DOMContentLoaded", onload, false);
    window.addEventListener("load", () => setTimeout(run, 500));

    /** @param {*=} absolute */
    function rle_link(id, absolute)
    {
        if(!id.endsWith(".mc"))
        {
            id = id + ".rle";
        }

        if(!absolute || location.hostname === "localhost")
        {
            return pattern_path + id;
        }
        else
        {
            let protocol = location.protocol === "http:" ? "http:" : "https:";
            return protocol + "//copy.sh/life/" + pattern_path + id;
        }
    }

    /**
     * @param {function()=} callback
     */
    function stop(callback)
    {
        if(running)
        {
            running = false;
            set_text($("run_button"), "Run");

            onstop = callback;
        }
        else
        {
            if(callback) {
                callback();
            }
        }
    }

    function reset_settings()
    {
        drawer.background_color = "#000000";
        drawer.cell_color = "#cccccc";

        drawer.border_width = DEFAULT_BORDER;
        drawer.cell_width = 2;

        life.rule_b = 1 << 3;
        life.rule_s = 1 << 2 | 1 << 3;
        life.set_step(0);

        max_fps = DEFAULT_FPS;

        drawer.center_view();
    }


    /**
     * @param {string=} pattern_source_url
     * @param {string=} view_url
     * @param {string=} title
     */
    function setup_pattern(pattern_text, pattern_id, pattern_source_url, view_url, title)
    {
        var result = formats.parse_pattern(pattern_text.trim());

        stop(function()
        {
            life.clear_pattern();

            var bounds = life.get_bounds(result.field_x, result.field_y);
            life.make_center(result.field_x, result.field_y, bounds);
            life.setup_field(result.field_x, result.field_y, bounds);
            life.save_rewind_state();

            if(result.rule_s && result.rule_b)
            {
                life.set_rules(result.rule_s, result.rule_b);
            }
            else
            {
                life.set_rules(1 << 2 | 1 << 3, 1 << 3);
            }

            fit_pattern();
            drawer.redraw(life.root);
        });
    }

    function fit_pattern()
    {
        var bounds = life.get_root_bounds();

        drawer.fit_bounds(bounds);
    }

    function run()
    {
        var n = 0,
            start,
            last_frame,
            frame_time = 1000 / max_fps,
            interval,
            per_frame = frame_time;

        set_text($("run_button"), "Stop");

        running = true;

        if(life.generation === 0)
        {
            life.save_rewind_state();
        }

        interval = setInterval(function()
        {
        }, 666);

        start = Date.now();
        last_frame = start - per_frame;

        function update()
        {
            if(!running)
            {
                clearInterval(interval);

                if(onstop) {
                    onstop();
                }
                return;
            }

            if (!mouse_down) {
                var time = Date.now();

                if(per_frame * n < (time - start))
                {
                    life.next_generation(true);
                    drawer.redraw(life.root);

                    n++;

                    // readability ... my ass
                    frame_time += (-last_frame - frame_time + (last_frame = time)) / 15;

                    if(frame_time < .7 * per_frame)
                    {
                        n = 1;
                        start = Date.now();
                    }
                }
            }

            nextFrame(update);
        }

        update();
    }

    function step(is_single)
    {
        var time = Date.now();

        if(life.generation === 0)
        {
            life.save_rewind_state();
        }

        life.next_generation(is_single);
        drawer.redraw(life.root);
    }

    function lazy_redraw(node)
    {
        if(!running || max_fps < 15)
        {
            drawer.redraw(node);
        }
    }

    function set_text(obj, text)
    {
        obj.textContent = String(text);
    }

    /**
     * fixes the width of an element to its current size
     */
    function fix_width(element)
    {
        element.style.padding = "0";
        element.style.width = "";

        if(!element.last_width || element.last_width < element.offsetWidth) {
            element.last_width = element.offsetWidth;
        }
        element.style.padding = "";

        element.style.width = element.last_width + "px";
    }


    function validate_color(color_str)
    {
        return /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(color_str) ? color_str : false;
    }

    /**
     * @param {function(string,number)=} onerror
     */
    function http_get(url, onready, onerror)
    {
        var http = new XMLHttpRequest();

        http.onreadystatechange = function()
        {
            if(http.readyState === 4)
            {
                if(http.status === 200)
                {
                    onready(http.responseText, url);
                }
                else
                {
                    if(onerror)
                    {
                        onerror(http.responseText, http.status);
                    }
                }
            }
        };

        http.open("get", url, true);
        http.send("");

        return {
            cancel : function()
            {
                http.abort();
            }
        };
    }

    /*
     * The mousemove event which allows moving around
     */
    function do_field_move(e)
    {
        if(last_mouse_x !== null)
        {
            let dx = Math.round(e.clientX - last_mouse_x);
            let dy = Math.round(e.clientY - last_mouse_y);

            drawer.move(dx, dy);

            //lazy_redraw(life.root);

            last_mouse_x += dx;
            last_mouse_y += dy;
        }
    }

    /*
     * The mousemove event which draw pixels
     */
    function do_field_draw(e)
    {
        var coords = drawer.pixel2cell(e.clientX, e.clientY);

        // don't draw the same pixel twice
        if(coords.x !== last_mouse_x || coords.y !== last_mouse_y)
        {
            life.set_bit(coords.x, coords.y, mouse_set);

            drawer.draw_cell(coords.x, coords.y, mouse_set);
            last_mouse_x = coords.x;
            last_mouse_y = coords.y;
        }
    }

    function $(id)
    {
        return document.getElementById(id);
    }

    function show_element(node)
    {
        node.style.display = "block";
    }

    function pad0(str, n)
    {
        while(str.length < n)
        {
            str = "0" + str;
        }

        return str;
    }

    // Put sep as a seperator into the thousands spaces of and Integer n
    // Doesn't handle numbers >= 10^21
    function format_thousands(n, sep)
    {
        if(n < 0)
        {
            return "-" + format_thousands(-n, sep);
        }

        if(isNaN(n) || !isFinite(n) || n >= 1e21)
        {
            return n + "";
        }

        function format(str)
        {
            if(str.length < 3)
            {
                return str;
            }
            else
            {
                return format(str.slice(0, -3)) + sep + str.slice(-3);
            }
        }

        return format(n + "");
    }


    function debounce(func, timeout)
    {
        var timeout_id;

        return function()
        {
            var me = this,
                args = arguments;

            clearTimeout(timeout_id);

            timeout_id = setTimeout(function()
            {
                func.apply(me, Array.prototype.slice.call(args));
            }, timeout);
        };
    }
})();
