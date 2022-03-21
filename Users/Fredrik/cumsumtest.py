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
from scipy.stats import gmean
from scipy.stats import gstd

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
    time_start = time()
    df = df_b[
        (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (
                df_b.date < pd.Timestamp(stop_date.val, unit="d"))]

    if isinstance(event.artist, Line2D):
        thisline = event.artist
        xdata = thisline.get_xdata()
        ydata = thisline.get_ydata()

        ind = event.ind

        points = tuple(zip(xdata[ind], ydata[ind]))
        dropindex = df[(df.nr == int(thisline.get_label())) & (df.date == xdata[ind][0])]
        df_b.drop(dropindex.index, axis=0, inplace=True)

        df = df_b[
            (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (
                    df_b.date < pd.Timestamp(stop_date.val, unit="d"))]
        # self.nr = dropindex.index[0]
        # self.getParams()
        # self.update()

        df_1 = df[df.treatment == int(dropindex.treatment)]

        plotDF(df_1, df_w, axs, drop="S")
        treatment_name = treatment_legend[int(dropindex.treatment)]["name"]
        axs["cumgraf"].set_title(
            treatment_name + " from:" + df.date.min().strftime("%Y-%m-%d") + " to:" + df.date.max().strftime(
                "%Y-%m-%d"))

        fig.canvas.draw()


    elif isinstance(event.artist, Rectangle):
        patch = event.artist
        print(int(patch.get_x() + (patch.get_width() / 2)))
        treatment_no = int(patch.get_x() + (patch.get_width() / 2)) + 1
        treatment_name = treatment_legend[treatment_no]["name"]

        df_1 = df[df.treatment == treatment_no]

        plotDF(df_1, df_w, axs, drop="S")
        axs["cumgraf"].set_title(
            treatment_name + " from:" + df.date.min().strftime("%Y-%m-%d") + " to:" + df.date.max().strftime(
                "%Y-%m-%d"))
        fig.canvas.draw()

    elif isinstance(event.artist, Text):
        text = event.artist
        fig2, axs2 = plt.subplots(nrows=2, ncols=1, figsize=(15, 12))
        treatment = treatment_df[treatment_df.name == text.get_text()].index[0]


def update(val):
    time_start = time()
    df = df_b[
        (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (
                df_b.date < pd.Timestamp(stop_date.val, unit="d"))]
    plotDF(df, df_w, axs)
    print(time() - time_start)


def xaligned_axes(ax, y_distance, width, **kwargs):
    return plt.axes([ax.get_position().x0,
                     ax.get_position().y0 - y_distance,
                     ax.get_position().width, width],
                    **kwargs)


def getN2Odata(df, plotno, tot_n2o_sum=[]):
    # Lazy way of averaging doublepoints on days
    # df = df[df.nr == plotno].groupby(df[df.nr == plotno].date.dt.date).mean()
    # df["date"] = df.index
    plot = df[df['nr'] == plotno]
    avg_plot = plot.groupby(pd.Grouper(key='date', freq='D')).mean()  # select the data from plot 2
    avg_plot = avg_plot[avg_plot['N2O_N_mug_m2h'].notna()]
    avg_plot["date"] = avg_plot.index
    n2o_avg_data = avg_plot['N2O_N_mug_m2h'].dropna() * 10000 / 1e9
    n2o_avg = n2o_avg_data.rolling(window=2).mean()
    n2o_avg.iloc[0] = 0.

    timediff = avg_plot["date"].diff() / pd.Timedelta(hours=1)
    timediff.iloc[0] = 0.

    n2o_sum = n2o_avg * timediff

    n2o_int = n2o_sum.cumsum()

    tot_n2o_sum = np.append(tot_n2o_sum, n2o_sum.sum())
    plot.index = plot.date
    n2o_int.index = avg_plot.date

    plot_n2o = plot['N2O_N_mug_m2h']

    return plot_n2o, tot_n2o_sum, n2o_int


def run_all_plots(df):
    plotdata = {}
    treatments = {}

    for treatment in np.sort(df['treatment'].unique()):
        # fig, (axs["samples"], axs["cumsum"], axs["cumgraf"]) = plt.subplots(nrows=3, ncols=1, sharex=True)
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
            "stdev": np.std(tot_n2o_sum),
            "gmean": gmean(df[(df["treatment"] == treatment) & (df.N2O_N_mug_m2h > 0.)].N2O_N_mug_m2h),
            "gstd": gstd(df[(df["treatment"] == treatment) & (df.N2O_N_mug_m2h > 0.)].N2O_N_mug_m2h)
        }

    return treatments, plotdata


def plotDF(df, df_w, axs, drop=""):
    treatments, plotdata = run_all_plots(df)
    avgsum = pd.DataFrame.from_dict(treatments, orient='index')

    if "B" not in drop:
        axs["boxplot"].cla()
        axs["boxplot"].set_yscale('log')

        dataset = []
        geo_avgs = []
        for treatment in np.sort(df.treatment.unique()):
            plot = df[df['treatment'] == treatment]
            avg_plot = plot.groupby(pd.Grouper(key='date', freq='D')).mean()  # select the data from plot 2
            avg_plot = avg_plot[avg_plot['N2O_N_mug_m2h'].notna()][
                'N2O_N_mug_m2h']  # [avg_plot['N2O_N_mug_m2h']>0]
            dataset.append(avg_plot)  # np.log(avg_plot))
        axs["boxplot"].boxplot(dataset)
        axs["boxplot"].set_ylim(1,None)
        axs["boxplot"].set_xticklabels(avgsum.index, rotation=20, ha='right')


    if "P" not in drop:
        axs["samples"].cla()
        for plotno in plotdata:
            axs["samples"].plot(plotdata[plotno]["data"], '-o', picker=True, pickradius=5, label=plotno)
    if "S" not in drop:
        axs["cumsum"].cla()

        xticks = np.arange(len(avgsum.index))

        axs["cumsum"].set_ylabel('N2O Emissions\nµG/m²/h')
        axs["cumsum"].bar(xticks, avgsum.avg, yerr=avgsum.stdev, align='center', alpha=0.5, ecolor='black',
                          capsize=6,
                          picker=True)
        axs["cumsum"].set_ylabel('N2O Emissions')
        axs["cumsum"].set_xticks(xticks)
        axs["cumsum"].set_xticklabels(avgsum.index, rotation=20, ha='right')

        axs["cumsum"].set_title('Treatment')
        axs["cumsum"].yaxis.grid(True)

    for label in axs["cumsum"].get_xticklabels():  # make the xtick labels pickable
        label.set_picker(True)

    if "C" not in drop:
        axs["cumgraf"].cla()
        for plotno in plotdata:
            axs["cumgraf"].plot(plotdata[plotno]["dataintsum"], '-o', picker=True, pickradius=5, label=plotno)
        axs["cumgraf"].tick_params(axis='x', rotation=20)

    if "W" not in drop:
        axs["rain"].cla()
        axs["temp"].cla()
        df_w = df_weather[df['date'].min():df['date'].max()]
        temp = df_w.resample("1D")

        axs["rain"].bar(temp['sum(precipitation_amount PT1H)'].sum().keys(),
                        temp['sum(precipitation_amount PT1H)'].sum())
        axs["temp"].plot(temp['air_temperature'].mean(), c="r")
        axs["temp"].fill_between(temp['air_temperature'].max().keys(), temp['air_temperature'].max(),
                                 temp['air_temperature'].min(), color="r", alpha=0.3)

if __name__ == "__main__":
    df_weather = pd.DataFrame.from_dict(dict(weather_data.weather_data_from_metno.get_stored_data())).T
    df_weather.index = pd.to_datetime(df_weather.index, unit='s')

    treatment_legend = {1: {'name': 'Control N1', 'plots': [9, 19, 30]},
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

    treatment_df = pd.DataFrame.from_dict(treatment_legend, orient='index')

    start = time()
    filename = "output/capture_slopes.xls"  # filename for raw output
    filename_manual = "output/capture_slopes_manual.xls"  # filename for raw output
    df_b = pd.read_excel(filename)  # import excel docuument
    df_m = pd.read_excel(filename_manual)
    df_b = pd.concat([df_b, df_m])
    df_b.index = df_b["Unnamed: 0"]

    df_b['date'] = pd.to_datetime(df_b['date'])  # make date column to datetime objects

    df_weather = df_weather[df_b['date'].min():df_b['date'].max()]
    df_w = df_weather
    df_b = df_b.sort_values(by=['date'])  # sort all entries by date
    # df_b = df_b[df_b.side == side]
    df = df_b

    # fig,axs = plt.subplots(nrows=3, ncols=2,figsize=(15, 12))
    fig = plt.figure(figsize=(15, 10))
    axs = {}

    axs["cumsum"] = plt.subplot(3, 3, 1)
    axs["boxplot"] = plt.subplot(3, 3, 2)
    axs["boxplot"].set_yscale('log')
    axs["cumgraf"] = plt.subplot(3, 3, 3)
    axs["samples"] = plt.subplot(3, 3, (4, 6))
    axs["rain"] = plt.subplot(3, 3, (7, 9), sharex=axs["samples"])
    axs["temp"] = axs["rain"].twinx()
    axs["temp"].set_ylabel('Temp C', color='g')
    axs["rain"].set_ylabel('MM/day', color='b')

    plotDF(df, df_w, axs)

    date_min = int(axs["samples"].get_xlim()[0])
    date_max = int(axs["samples"].get_xlim()[1])
    plt.tight_layout()
    ax_slider1 = xaligned_axes(ax=axs["samples"], y_distance=0.05, width=0.01, facecolor="r")
    ax_slider2 = xaligned_axes(ax=axs["samples"], y_distance=0.07, width=0.01, facecolor="r")
    start_date = Slider(ax_slider1, 'Start', date_min, date_max, valinit=date_min, valstep=1, dragging=False)
    stop_date = Slider(ax_slider2, 'Stop', date_min, date_max, valinit=date_max, valstep=1, dragging=False)
    # df = df.set_index('date')

    fig.canvas.mpl_connect('pick_event', onpick)
    start_date.on_changed(update)
    stop_date.on_changed(update)

    plt.show()