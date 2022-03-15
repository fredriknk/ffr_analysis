#!/usr/bin/python

import sys
import numpy as np
import datetime
import random
import matplotlib
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider

fig, ax = plt.subplots()
plt.subplots_adjust(bottom=0.25)

x = [datetime.datetime(2015,6,25) + datetime.timedelta(hours=i) for i in range(25)]
y = [i+random.gauss(0,1) for i,_ in enumerate(x)]

l, = plt.plot(x,y)

x_min_index = 0
x_max_index = 5

x_min = x[x_min_index]
x_max = x[x_max_index]

# timedelta
x_dt = x_max - x_min

# plt.axis(x_min, x_max, y_min, y_max)
y_min = plt.axis()[2]
y_max = plt.axis()[3]

plt.axis([x_min, x_max, y_min, y_max])


axcolor = 'lightgoldenrodyellow'
axpos = plt.axes([0.2, 0.1, 0.65, 0.03], axisbg=axcolor)

slider_max = len(x) - x_max_index - 1

# Slider(axes, name, min, max)
spos = Slider(axpos, 'Pos', matplotlib.dates.date2num(x_min), matplotlib.dates.date2num(x[slider_max]))

# pretty date names
plt.gcf().autofmt_xdate()

def update(val):
    pos = spos.val
    xmin_time = matplotlib.dates.num2date(pos)
    xmax_time = matplotlib.dates.num2date(pos) + x_dt
    # print "x_min: %s, x_max: %s" % (xmin_time.strftime("%H:%M:%S.%f"), xmax_time.strftime("%H:%M:%S.%f"))

    ########################################################
    # RETURNS THE SAME RESULT:

    # xmin_time is datetime.datetime
    # print type(xmin_time)
    # ax.axis([xmin_time, xmax_time, y_min, y_max])

    # xmin_time is numpy.float64
    xmin_time = pos
    print( type(xmin_time))
    ax.axis([xmin_time, xmax_time, y_min, y_max])
    ########################################################
    fig.canvas.draw_idle()

spos.on_changed(update)

plt.show()