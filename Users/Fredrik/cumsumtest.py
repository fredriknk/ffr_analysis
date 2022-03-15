from matplotlib.widgets import Slider
import sys
import os
import numpy as np
import pandas as pd
from time import time
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
from matplotlib.text import Text

sys.path.append(os.path.realpath(os.path.join(os.getcwd(), '../../prog')))
from regression import *
import weather_data
import find_regressions
import bisect_find
import utils
import resdir
import csv
import read_regression_exception_list
import flux_calculations


def onpick(event):
    df = df_b[
        (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (df_b.date < pd.Timestamp(stop_date.val, unit="d"))]
    print(df.date)

    if isinstance(event.artist, Line2D):
        thisline = event.artist
        xdata = thisline.get_xdata()
        ydata = thisline.get_ydata()

        ind = event.ind

        points = tuple(zip(xdata[ind], ydata[ind]))
        print('onpick1 line:', thisline.get_label(), xdata[ind][0])
        dropindex = df[(df.nr == int(thisline.get_label())) & (df.date == xdata[ind][0])]
        print(dropindex.treatment)
        print(dropindex.index)
        df_b.drop(dropindex.index, axis=0, inplace=True)

        df = df_b[
            (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (
                    df_b.date < pd.Timestamp(stop_date.val, unit="d"))]

        df_1 = df[df.treatment == int(dropindex.treatment)]

        plotDF(df_1, ax1, ax2, ax3, drop="S")
        plotDF(df, ax1, ax2, ax3, drop="PC")
        fig.canvas.draw()

    elif isinstance(event.artist, Rectangle):
        patch = event.artist
        treatment_name = treatment_df.name.sort_values().iloc[int(patch.get_x() + (patch.get_width() / 2))]
        treatment_no = treatment_df.name.sort_values().index[int(patch.get_x() + (patch.get_width() / 2))]
        df_1 = df[df.treatment == treatment_no]

        plotDF(df_1, ax1, ax2, ax3, drop="S")
        ax3.set_title(treatment_name + " from:" + df.date.min().strftime("%Y-%m-%d") + " to:" + df.date.max().strftime(
            "%Y-%m-%d"))
        fig.canvas.draw()

    elif isinstance(event.artist, Text):
        text = event.artist
        print('onpick1 text:', text.get_text())
        fig2, axs2 = plt.subplots(nrows=2, ncols=1, figsize=(15, 12))
        treatment = treatment_df[treatment_df.name == text.get_text()].index[0]


def update(val):
    print(pd.Timestamp(start_date.val, unit="d"), pd.Timestamp(stop_date.val, unit="d"))
    df = df_b[
        (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (df_b.date < pd.Timestamp(stop_date.val, unit="d"))]
    plotDF(df, ax1, ax2, ax3)


def xaligned_axes(ax, y_distance, width, **kwargs):
    return plt.axes([ax.get_position().x0,
                     ax.get_position().y0 - y_distance,
                     ax.get_position().width, width],
                    **kwargs)


def getN2Odata(df, plotno, tot_n2o_sum=[]):
    # Lazy way of averaging doublepoints on days
    # df = df[df.nr == plotno].groupby(df[df.nr == plotno].date.dt.date).mean()
    # df["date"] = df.index

    plot = df[df['nr'] == plotno]  # select the data from plot 2

    n2o = plot['N2O_N_mug_m2h'] * 10000 / 1e9
    n2o_avg = n2o.rolling(window=2).mean()
    n2o_avg.iloc[0] = 0.

    timediff = plot["date"].diff() / pd.Timedelta(hours=1)
    timediff.iloc[0] = 0.

    n2o_sum = n2o_avg * timediff

    n2o_int = n2o_sum.cumsum()

    tot_n2o_sum = np.append(tot_n2o_sum, n2o_sum.sum())
    plot.index = plot.date
    n2o_int.index = plot.date
    plot_n2o = plot['N2O_N_mug_m2h']

    return plot_n2o, tot_n2o_sum, n2o_int


def run_all_plots(df):
    plotdata = {}
    treatments = {}
    for treatment in np.sort(df['treatment'].unique()):
        # fig, (ax1, ax2, ax3) = plt.subplots(nrows=3, ncols=1, sharex=True)
        tot_n2o_sum = np.array([])
        for plotno in np.sort(df[df['treatment'] == treatment]['nr'].unique()):
            plot_n2o, tot_n2o_sum, n2o_int = getN2Odata(df, plotno, tot_n2o_sum)
            plotdata[plotno] = {
                "name": plotno,
                "data": plot_n2o,
                "dataintsum": n2o_int
            }

        treatments[treatment_legend[treatment]["name"]] = {
            "avg": np.average(tot_n2o_sum),
            "stdev": np.std(tot_n2o_sum)
        }

    return treatments, plotdata


def plotDF(df, ax1, ax2, ax3, drop=""):
    treatments, plotdata = run_all_plots(df)
    if "P" not in drop:
        ax1.cla()
        for plotno in plotdata:
            ax1.plot(plotdata[plotno]["data"], '-o', picker=True, pickradius=5, label=plotno)

    if "S" not in drop:
        ax2.cla()

        avgsum = pd.DataFrame.from_dict(treatments, orient='index').sort_index()
        xticks = np.arange(len(avgsum.index))

        ax2.set_ylabel('N2O Emissions\nµG/m²/h')
        ax2.bar(xticks, avgsum.avg, yerr=avgsum.stdev, align='center', alpha=0.5, ecolor='black', capsize=6,
                picker=True)
        ax2.set_ylabel('N2O Emissions')
        ax2.set_xticks(xticks)
        ax2.set_xticklabels(avgsum.index, rotation=20, ha='right')

        ax2.set_title('Treatment')
        ax2.yaxis.grid(True)

    for label in ax2.get_xticklabels():  # make the xtick labels pickable
        label.set_picker(True)

    if "C" not in drop:
        ax3.cla()
        for plotno in plotdata:
            ax3.plot(plotdata[plotno]["dataintsum"], '-o', picker=True, pickradius=5, label=plotno)


if __name__ == "__main__":
    treatment_legend =  {1: {'name': 'Control N1', 'plots': [9, 19, 30]},
                         2: {'name': 'Control N2', 'plots': [2, 18, 27]},
                         3: {'name': 'Perenial ryegrass N1', 'plots': [12, 23, 25]},
                         4: {'name': 'Perenial ryegrass N2', 'plots': [5, 15, 28]},
                         5: {'name': 'Italian ryegrass N1', 'plots': [10, 17, 29]},
                         6: {'name': 'Italian ryegrass N2', 'plots': [1, 22, 32]},
                         7: {'name': 'Summer vetch N1', 'plots': [4, 20, 36]},
                         8: {'name': 'Winter vetch N1', 'plots': [11, 21, 35]},
                         9: {'name': 'Oilseed radish N1', 'plots': [6, 24, 34]},
                         10: {'name': 'Oilseed radish N2', 'plots': [8, 16, 26]},
                         11: {'name': 'Phaselia N2', 'plots': [7, 14, 31]},
                         12: {'name': 'Grønn bro N1', 'plots': [3, 13, 33]}}

    treatment_df = pd.DataFrame.from_dict(treatment_legend,orient='index')

    start = time()
    filename = "output/capture_slopes.xls"  #filename for raw output
    filename_manual = "output/capture_slopes_manual.xls"  # filename for raw output
    df_b = pd.read_excel(filename) # import excel docuument
    # df_m = pd.read_excel(filename_manual)
    # df_b =pd.concat([df_b,df_m])
    df_b.index= df_b["Unnamed: 0"]

    df_b['date'] = pd.to_datetime(df_b['date']) # make date column to datetime objects
    df_b = df_b.sort_values(by=['date']) #sort all entries by date
    # df_b = df_b[df_b.side == side]
    df = df_b

    # fig,axs = plt.subplots(nrows=3, ncols=2,figsize=(15, 12))
    fig = plt.figure(figsize=(6, 4))

    ax1 = plt.subplot(2,2,(3,4))
    ax2 = plt.subplot(2,2,1)
    ax3 = plt.subplot(2,2,2)

    plotDF(df, ax1, ax2, ax3)
    date_min = int(ax1.get_xlim()[0])
    date_max = int(ax1.get_xlim()[1])

    ax_slider1 = xaligned_axes(ax=ax1, y_distance=0.05, width=0.01, facecolor="r")
    ax_slider2 = xaligned_axes(ax=ax1, y_distance=0.07, width=0.01, facecolor="r")
    start_date = Slider(ax_slider1, 'Start', date_min, date_max, valinit=date_min, valstep=1,dragging=False)
    stop_date = Slider(ax_slider2,  'Stop', date_min, date_max, valinit=date_max, valstep=1,dragging=False)
    # df = df.set_index('date')

    fig.canvas.mpl_connect('pick_event', onpick)
    start_date.on_changed(update)
    stop_date.on_changed(update)
    plt.show()